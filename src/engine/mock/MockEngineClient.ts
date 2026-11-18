/**
 * Mock-реализация EngineClient: имитирует WebSocket-поток и REST-методы движка в браузере.
 * Интерактивный запуск — таймер раз в 200 мс реального времени; виртуальный шаг = 0,2 с × скорость
 * (на больших скоростях делится на подшаги, чтобы модель очередей оставалась устойчивой).
 */
import { TEMPLATES } from '@/features/projects/templates';
import { nodeById } from '@/schema/analysis';
import type { Schema } from '@/schema/types';
import { validateSchema } from '@/schema/validate';
import type {
  ConnectionStatus,
  EngineClient,
  EngineCommand,
  EngineMessage,
  ExperimentConfig,
  ExperimentProgress,
  ExperimentReport,
  MessageListener,
  StatusListener,
  TemplateInfo,
} from '../types';
import { aggregate, planRuns, prepareRunSchema, runOnce, type RunMetrics } from './experiments';
import { SimModel } from './model';

const TICK_MS = 200;
const MAX_SUBSTEP_S = 0.25;

interface ExperimentState {
  config: ExperimentConfig;
  progress: ExperimentProgress;
  results: Map<string, RunMetrics[]>;
  startedAt: number;
  report?: ExperimentReport;
}

export class MockEngineClient implements EngineClient {
  readonly kind = 'mock' as const;
  private listeners = new Set<MessageListener>();
  private model: SimModel | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private speed = 1;
  private paused = false;
  private experiments = new Map<string, ExperimentState>();
  private expSeq = 0;

  send(cmd: EngineCommand): void {
    switch (cmd.type) {
      case 'start':
        this.model = new SimModel(cmd.schema, cmd.schema.seed);
        this.speed = cmd.speed;
        this.paused = false;
        this.startTimer();
        break;
      case 'pause':
        this.paused = true;
        break;
      case 'resume':
        this.paused = false;
        break;
      case 'stop':
        this.stopTimer();
        if (this.model) this.emit({ type: 'finished', t: this.model.time });
        this.model = null;
        break;
      case 'setSpeed':
        this.speed = cmd.speed;
        break;
      case 'patch':
        this.model?.setSchema(cmd.schema);
        break;
      case 'injectFault':
        this.model?.injectFault(cmd.faultId, cmd.action, cmd.durationS);
        break;
      case 'clearFault':
        this.model?.clearFault(cmd.faultId);
        break;
      case 'setLoad':
        this.model?.setLoad(cmd.clientId, cmd.rps);
        break;
      case 'getTrace': {
        const trace = this.model?.getTrace(cmd.txId);
        // Ответ асинхронный, как у настоящего движка.
        setTimeout(() => {
          if (trace) this.emit(trace);
          else this.emit({ type: 'error', code: 'traceNotFound', message: cmd.txId });
        }, 30);
        break;
      }
    }
  }

  onMessage(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    listener('open');
    return () => {};
  }

  status(): ConnectionStatus {
    return 'open';
  }

  private emit(msg: EngineMessage) {
    for (const l of this.listeners) l(msg);
  }

  private startTimer() {
    this.stopTimer();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick() {
    if (!this.model || this.paused) return;
    const dt = (TICK_MS / 1000) * this.speed;
    const n = Math.max(1, Math.ceil(dt / MAX_SUBSTEP_S));
    for (let i = 0; i < n; i++) {
      const last = i === n - 1;
      const out = this.model.step(dt / n, last ? TICK_MS : 0, this.speed);
      for (const a of out.alerts) this.emit(a);
      for (const v of out.violations) this.emit(v);
      if (last) {
        this.emit(out.tick);
        if (out.flows.length) this.emit({ type: 'flows', t: out.tick.t, items: out.flows });
      }
    }
  }

  /* ---------------- REST ---------------- */

  async validate(schema: Schema) {
    return { issues: validateSchema(schema) };
  }

  async listTemplates(): Promise<TemplateInfo[]> {
    return TEMPLATES.map((t) => ({ id: t.id, kind: 'template', name: t.id, description: t.id }));
  }

  async getTemplate(id: string): Promise<Schema> {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) throw new Error(`template ${id} not found`);
    return t.build();
  }

  async createExperiment(config: ExperimentConfig): Promise<{ id: string }> {
    const id = `exp-${Date.now().toString(36)}-${++this.expSeq}`;
    const total = planRuns(config).length;
    const st: ExperimentState = {
      config,
      progress: { id, status: 'running', done: 0, total, etaS: 0 },
      results: new Map(),
      startedAt: performance.now(),
    };
    this.experiments.set(id, st);
    this.runExperiment(st);
    return { id };
  }

  private runExperiment(st: ExperimentState) {
    const runs = planRuns(st.config);
    let i = 0;
    const next = () => {
      if (st.progress.status !== 'running') return;
      if (i >= runs.length) {
        st.progress = { ...st.progress, status: 'done', etaS: 0 };
        st.report = this.buildReport(st);
        return;
      }
      const r = runs[i++];
      const schema = prepareRunSchema(st.config.schema, st.config.endpointId, r.pattern, r.load, st.config.faults);
      const metrics = runOnce(schema, r.seed, st.config.durationS);
      const key = `${r.pattern}|${r.load}`;
      st.results.set(key, [...(st.results.get(key) ?? []), metrics]);
      const elapsed = (performance.now() - st.startedAt) / 1000;
      st.progress = { ...st.progress, done: i, etaS: Math.round((elapsed / i) * (runs.length - i)) };
      // Небольшая пауза между прогонами, чтобы прогресс был виден и UI не подвисал.
      setTimeout(next, 40);
    };
    setTimeout(next, 0);
  }

  private buildReport(st: ExperimentState): ExperimentReport {
    const { schema, ...config } = st.config;
    const rows = [];
    for (const pattern of config.patterns)
      for (const load of config.loadLevels) rows.push(aggregate(pattern, load, st.results.get(`${pattern}|${load}`) ?? []));
    const ep = schema.endpoints.find((e) => e.id === config.endpointId);
    return {
      id: st.progress.id,
      createdAt: new Date().toISOString(),
      projectName: schema.meta.name,
      endpointName: ep ? `${nodeById(schema, ep.serviceId)?.name ?? ''} · ${ep.name}` : config.endpointId,
      config,
      rows,
    };
  }

  async getExperiment(id: string): Promise<ExperimentProgress> {
    const st = this.experiments.get(id);
    if (!st) throw new Error(`experiment ${id} not found`);
    return st.progress;
  }

  async getReport(id: string): Promise<ExperimentReport> {
    const st = this.experiments.get(id);
    if (!st?.report) throw new Error(`report ${id} not ready`);
    return st.report;
  }

  async cancelExperiment(id: string): Promise<void> {
    const st = this.experiments.get(id);
    if (st && st.progress.status === 'running') st.progress = { ...st.progress, status: 'cancelled' };
  }
}
