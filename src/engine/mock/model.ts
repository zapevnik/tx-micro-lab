/**
 * Имитационная модель mock-движка.
 *
 * Это НЕ настоящий движок, а правдоподобная заглушка для разработки интерфейса:
 * сетевая модель очередей (загрузка = входящий RPS / ёмкость узла) плюс эвристики паттернов
 * транзакций, чтобы графики и отчёты различались по паттернам. Все случайности идут через
 * детерминированный генератор, поэтому один seed даёт одинаковые цифры.
 *
 * Модель сама применяет запланированные отказы из `schema.faults` по виртуальному времени,
 * поэтому один и тот же класс используется и для интерактивного запуска, и для пакетного сравнения.
 */
import {
  derivedNodes,
  subscribersOf,
  txNeedsDistributedPattern,
  txSteps,
} from '@/schema/analysis';
import { getAction } from '@/schema/dictionary';
import { numParam, strParam } from '@/schema/params';
import type { Endpoint, FaultAction, InvariantType, Schema, SchemaEdge, SchemaNode, Step } from '@/schema/types';
import type {
  AlertCode,
  AlertMsg,
  EdgeMetrics,
  FlowItem,
  GlobalMetrics,
  NodeMetrics,
  TickMsg,
  TraceMsg,
  TraceSpan,
  TxOutcome,
  TxSummary,
  ViolationMsg,
} from '../types';
import { createRng, jitter } from './rng';

export interface StepOutput {
  tick: TickMsg;
  flows: FlowItem[];
  alerts: AlertMsg[];
  violations: ViolationMsg[];
}

interface NodeState {
  q: number;
  backlog: number;
  stuckLocks: number;
  lambda: number;
  mu: number;
  costMs: number;
  W: number;
  err: number;
  load: number;
  locks: number;
  lagMs: number;
}

interface EpResult {
  lat: number;
  pFail: number;
  msgs: number;
}

interface ActiveFault {
  action: FaultAction;
  untilT: number | null;
}

interface TxRecord {
  summary: TxSummary;
  W: Record<string, number>;
  failAt: number;
}

const BASE_DISTRIBUTED_FAIL = 0.003;
const MAX_LATENCY_MS = 30_000;
const FLOWS_PER_REAL_S = 45;

export class SimModel {
  private schema!: Schema;
  private rng: () => number;
  private t = 0;
  private nodes = new Map<string, SchemaNode>();
  private edgeByPair = new Map<string, SchemaEdge>();
  private epById = new Map<string, Endpoint>();
  private state = new Map<string, NodeState>();
  private loadOverride = new Map<string, number>();
  private manualFaults = new Map<string, ActiveFault>();
  private epLatPrev = new Map<string, number>();
  private epRate = new Map<string, number>();
  private alertsOn = new Set<string>();
  private violationCarry = new Map<string, number>();
  private violationsTotal = 0;
  private txSeq = 0;
  private txLog: TxRecord[] = [];
  private txSampleCarry = 0;
  private flowCarry = 0;

  constructor(schema: Schema, seed: number) {
    this.rng = createRng(seed);
    this.setSchema(schema);
  }

  get time(): number {
    return this.t;
  }

  /** Подмена схемы на лету (команда patch). Состояние очередей сохраняется по id узлов. */
  setSchema(schema: Schema): void {
    this.schema = schema;
    // Схема из patch — источник правды о нагрузке; оперативные setLoad больше не нужны.
    this.loadOverride.clear();
    this.nodes = new Map(schema.nodes.map((n) => [n.id, n]));
    this.edgeByPair = new Map(schema.edges.map((e) => [`${e.source}>${e.target}`, e]));
    this.epById = new Map(schema.endpoints.map((e) => [e.id, e]));
    for (const n of schema.nodes)
      if (!this.state.has(n.id))
        this.state.set(n.id, {
          q: 0,
          backlog: 0,
          stuckLocks: 0,
          lambda: 0,
          mu: 1,
          costMs: 1,
          W: 1,
          err: 0,
          load: 0,
          locks: 0,
          lagMs: 0,
        });
  }

  setLoad(clientId: string, rps: number): void {
    this.loadOverride.set(clientId, rps);
  }

  injectFault(id: string, action: FaultAction, durationS?: number): void {
    this.manualFaults.set(id, { action, untilT: durationS ? this.t + durationS : null });
  }

  clearFault(id: string): void {
    this.manualFaults.delete(id);
  }

  /* ---------------- Отказы ---------------- */

  private activeFaults(): FaultAction[] {
    const out: FaultAction[] = [];
    for (const [id, f] of this.manualFaults) {
      if (f.untilT !== null && this.t >= f.untilT) this.manualFaults.delete(id);
      else out.push(f.action);
    }
    for (const f of this.schema.faults) {
      if (this.t >= f.atS && (f.durationS === 0 || this.t < f.atS + f.durationS)) out.push(f.action);
    }
    return out;
  }

  private faults: FaultAction[] = [];

  private isDown(id: string): boolean {
    return this.faults.some((f) => f.type === 'nodeDown' && f.nodeId === id);
  }

  private slowFactor(id: string): number {
    let k = 1;
    for (const f of this.faults) if (f.type === 'nodeSlow' && f.nodeId === id) k *= f.factor;
    return k;
  }

  private edgeExtra(edge: SchemaEdge | undefined): { delay: number; loss: number; dup: number } {
    if (!edge) return { delay: 0, loss: 0, dup: 0 };
    let delay = edge.network.latencyMs;
    let loss = edge.network.lossPct / 100;
    let dup = 0;
    for (const f of this.faults) {
      if (!('edgeId' in f) || f.edgeId !== edge.id) continue;
      if (f.type === 'linkDelay') delay += f.delayMs;
      if (f.type === 'linkLoss') loss = 1 - (1 - loss) * (1 - f.pct / 100);
      if (f.type === 'linkDuplicate') dup += f.pct / 100;
      if (f.type === 'linkPartition') loss = 1;
    }
    return { delay, loss: Math.min(1, loss), dup };
  }

  private coordinatorDown(ep: Endpoint): boolean {
    const tx = ep.transaction;
    if (!tx) return false;
    if (this.faults.some((f) => f.type === 'coordinatorCrash' && f.endpointId === ep.id)) return true;
    return !!tx.coordinatorId && this.isDown(tx.coordinatorId);
  }

  /* ---------------- Нагрузка клиентов (5.7) ---------------- */

  private clientRps(clientId: string): number {
    const w = this.schema.workload.find((x) => x.clientId === clientId);
    if (!w) return 0;
    const base = this.loadOverride.get(clientId) ?? w.rps;
    const t = this.t;
    switch (w.profile) {
      case 'constant':
        return base;
      case 'ramp':
        return base * Math.min(2, 0.2 + t / 60);
      case 'spike':
        return base * (t % 60 >= 30 && t % 60 < 40 ? 4 : 1);
      case 'sine':
        return base * (1 + 0.5 * Math.sin((2 * Math.PI * t) / 60));
    }
  }

  /* ---------------- Шаг модели ---------------- */

  step(dt: number, realDtMs = 0, speed = 1): StepOutput {
    this.t += dt;
    this.faults = this.activeFaults();
    const acc = new Map<string, { lambda: number; work: number }>();
    const eacc = new Map<string, { rps: number; comp: number }>();
    const epRate = new Map<string, number>();
    const prevErr = (id: string) => this.state.get(id)?.err ?? 0;

    const addNode = (id: string, rate: number, costMs: number) => {
      const a = acc.get(id) ?? { lambda: 0, work: 0 };
      a.lambda += rate;
      a.work += rate * costMs;
      acc.set(id, a);
    };
    const addEdge = (src: string, tgt: string, rate: number) => {
      const e = this.edgeByPair.get(`${src}>${tgt}`);
      if (!e) return;
      const a = eacc.get(e.id) ?? { rps: 0, comp: 0 };
      a.rps += rate;
      eacc.set(e.id, a);
    };

    // Физические узлы БД, на которые попадает операция (шарды, реплики).
    const routeDb = (dbId: string, rate: number, write: boolean, extraMs: number) => {
      const db = this.nodes.get(dbId);
      if (!db) return;
      const shards = db.scaling?.sharding ? derivedNodes(this.schema, dbId, 'shard') : [];
      const physical: [SchemaNode, number][] = [];
      if (shards.length) {
        addNode(dbId, rate, 0.05);
        for (const s of shards) {
          addEdge(dbId, s.id, rate / shards.length);
          physical.push([s, rate / shards.length]);
        }
      } else physical.push([db, rate]);
      for (const [p, r] of physical) {
        const opMs = numParam(p.params, 'database', write ? 'writeMs' : 'readMs');
        const repl = p.scaling?.replication;
        const replicas = repl ? derivedNodes(this.schema, p.id, 'replica').filter((x) => !this.isDown(x.id)) : [];
        if (!write && repl?.readPolicy === 'replicas' && replicas.length) {
          for (const rep of replicas) {
            addNode(rep.id, r / replicas.length, opMs);
            addEdge(p.id, rep.id, r / replicas.length);
          }
          continue;
        }
        addNode(p.id, r, opMs + extraMs);
        if (write)
          for (const rep of replicas) {
            addNode(rep.id, r, opMs * 0.4);
            addEdge(p.id, rep.id, r);
          }
      }
    };

    const invoke = (ep: Endpoint, rate: number, depth: number) => {
      if (depth > 6 || rate <= 0) return;
      epRate.set(ep.id, (epRate.get(ep.id) ?? 0) + rate);
      const svc = this.nodes.get(ep.serviceId);
      if (!svc) return;
      const compute = ep.steps.filter((s) => s.type === 'compute').reduce((a, s) => a + s.durationMs, 0);
      addNode(svc.id, rate, numParam(svc.params, 'service', 'baseMs') + compute);
      if (this.isDown(svc.id)) return;
      const tx = ep.transaction;
      const inTx = new Set(txSteps(ep).map((s) => s.id));
      const lockExtra = tx?.pattern === '2pc' ? 0.12 * this.lockHoldMs(ep) : tx?.pattern === 'local' ? 1 : 0;
      for (const s of ep.steps) {
        if (!s.targetId) continue;
        const target = this.nodes.get(s.targetId);
        if (!target) continue;
        switch (s.type) {
          case 'dbRead':
          case 'dbWrite':
            addEdge(svc.id, target.id, rate);
            routeDb(target.id, rate, s.type === 'dbWrite', s.type === 'dbWrite' && inTx.has(s.id) ? lockExtra : 0);
            if (tx?.pattern === '2pc' && s.type === 'dbWrite' && inTx.has(s.id))
              routeDb(target.id, rate, true, 0); // prepare-запись в журнал участника
            break;
          case 'cacheRead':
          case 'cacheWrite':
            addEdge(svc.id, target.id, rate);
            addNode(target.id, rate, 0.2);
            break;
          case 'call': {
            const callee = s.targetEndpointId ? this.epById.get(s.targetEndpointId) : undefined;
            const retries = numParam(svc.params, 'service', 'retries');
            const amp = 1 + retries * Math.min(1, prevErr(target.id));
            addEdge(svc.id, target.id, rate * amp);
            if (callee) invoke(callee, rate * amp, depth + 1);
            else addNode(target.id, rate * amp, numParam(target.params, 'service', 'baseMs'));
            break;
          }
          case 'publish': {
            addEdge(svc.id, target.id, rate);
            addNode(target.id, rate, 0);
            if (this.isDown(target.id) || !s.topic) break;
            const brokerDup = numParam(target.params, 'broker', 'duplicatePct') / 100;
            for (const sub of subscribersOf(this.schema, s.topic)) {
              const dup = brokerDup + this.edgeExtra(this.edgeByPair.get(`${target.id}>${sub.serviceId}`)).dup;
              const delivered = rate * (1 + dup);
              if (this.isDown(sub.serviceId)) {
                this.st(target.id).backlog += delivered * dt;
                continue;
              }
              addEdge(target.id, sub.serviceId, delivered);
              invoke(sub, delivered, depth + 1);
            }
            break;
          }
          default:
            break;
        }
      }
      if (tx?.coordinatorId && tx.coordinatorId !== svc.id && (tx.pattern === '2pc' || tx.pattern === 'sagaOrchestration'))
        addNode(tx.coordinatorId, rate, 1);
    };

    // Клиенты → (шлюзы, балансировщики) → сервисы.
    for (const c of this.schema.nodes) {
      if (c.kind !== 'client') continue;
      const w = this.schema.workload.find((x) => x.clientId === c.id);
      if (!w) continue;
      const rps = this.clientRps(c.id);
      addNode(c.id, rps, 0);
      for (const m of w.mix) {
        const ep = this.epById.get(m.endpointId);
        if (!ep) continue;
        const rate = (rps * m.pct) / 100;
        const path = this.pathTo(c.id, ep.serviceId);
        if (!path) continue;
        for (let i = 0; i + 1 < path.length; i++) {
          addEdge(path[i], path[i + 1], rate);
          const mid = this.nodes.get(path[i + 1]);
          if (mid && (mid.kind === 'gateway' || mid.kind === 'balancer'))
            addNode(mid.id, rate, mid.kind === 'gateway' ? numParam(mid.params, 'gateway', 'routingMs') : 0.05);
        }
        invoke(ep, rate, 0);
      }
    }
    this.epRate = epRate;

    /* ---- Состояние узлов: ёмкость, очередь, задержка, ошибки ---- */
    for (const n of this.schema.nodes) {
      const s = this.st(n.id);
      const a = acc.get(n.id) ?? { lambda: 0, work: 0 };
      const slow = this.slowFactor(n.id);
      s.lambda = a.lambda;
      s.costMs = (a.lambda > 0 ? a.work / a.lambda : this.baseCost(n)) * slow;
      s.mu = this.capacity(n, s) / slow;
      if (this.isDown(n.id)) {
        s.q = 0;
        s.err = a.lambda > 0 ? 1 : 0;
        s.W = 0;
        s.load = 0;
        continue;
      }
      const rho = s.mu > 0 ? s.lambda / s.mu : 0;
      s.load = rho;
      if (n.kind === 'broker') {
        const drain = Math.max(0, s.mu - s.lambda) * dt;
        s.backlog = Math.max(0, s.backlog + Math.max(0, s.lambda - s.mu) * dt - drain);
        s.q = s.backlog;
        s.err = 0;
        s.W = numParam(n.params, 'broker', 'deliveryMs') + (s.backlog / Math.max(1, s.mu)) * 1000;
        continue;
      }
      if (n.kind === 'client') {
        s.W = 0;
        s.err = 0;
        s.load = 0;
        continue;
      }
      if (rho < 1) {
        const target = (Math.pow(rho, 6) / (1 - rho)) * 3;
        s.q += (target - s.q) * Math.min(1, dt * 1.5);
      } else s.q += (s.lambda - s.mu) * dt;
      const timeoutS = n.kind === 'service' ? numParam(n.params, 'service', 'timeoutMs') / 1000 : 2;
      const qMax = Math.max(20, s.mu * timeoutS);
      if (s.q >= qMax) {
        s.q = qMax;
        s.err = s.lambda > 0 ? Math.max(0, (s.lambda - s.mu) / s.lambda) : 0;
      } else s.err = 0;
      s.q = Math.max(0, s.q);
      s.W = s.costMs + (s.q / Math.max(s.mu, 1e-6)) * 1000;
    }

    // Реплики: отставание (5.4) — растёт при перегрузке реплики.
    for (const n of this.schema.nodes) {
      if (n.role !== 'replica' || !n.groupId) continue;
      const leader = this.nodes.get(n.groupId);
      const repl = leader?.scaling?.replication;
      if (!repl) continue;
      const s = this.st(n.id);
      const base = repl.mode === 'sync' ? 1 : repl.lagMs;
      const target = this.isDown(n.id) ? s.lagMs + dt * 1000 : base * (1 + Math.pow(Math.min(s.load, 3), 4) * 8);
      s.lagMs += (target - s.lagMs) * Math.min(1, dt * 2);
    }

    /* ---- Задержки и исходы эндпоинтов ---- */
    const memo = new Map<string, EpResult>();
    const result = (ep: Endpoint, depth: number): EpResult => {
      const hit = memo.get(ep.id);
      if (hit) return hit;
      const r = this.endpointResult(ep, depth, result);
      memo.set(ep.id, r);
      return r;
    };
    for (const ep of this.schema.endpoints) this.epLatPrev.set(ep.id, result(ep, 0).lat);

    const g = { thr: 0, lat: 0, p99: 0, w: 0, err: 0, committed: 0, rolledBack: 0, compensated: 0, stuck: 0, failed: 0, msgs: 0, txs: 0 };
    const violations: ViolationMsg[] = [];
    const outcomesByEp = new Map<string, Record<TxOutcome, number>>();
    const clientFacing = new Set<string>();
    for (const w of this.schema.workload) for (const m of w.mix) clientFacing.add(m.endpointId);

    for (const ep of this.schema.endpoints) {
      const rate = epRate.get(ep.id) ?? 0;
      if (rate <= 0) continue;
      const r = result(ep, 0);
      const tx = ep.transaction;
      const o: Record<TxOutcome, number> = { committed: 0, rolledBack: 0, compensated: 0, stuck: 0, violated: 0, failed: 0 };
      let vRate = 0;
      let vKind: 'partial' | 'dup' | 'isolation' | 'lost' = 'partial';
      const p = Math.min(1, r.pFail);
      if (!tx) {
        o.committed = rate * (1 - p);
        o.failed = rate * p;
      } else {
        const spread = txNeedsDistributedPattern(this.schema, ep);
        const writes = txSteps(ep).filter((s) => s.type === 'dbWrite').length;
        switch (tx.pattern) {
          case 'none':
            o.committed = rate * (1 - p);
            o.failed = rate * p;
            if (writes >= 2 || spread) vRate = rate * (p + (spread ? BASE_DISTRIBUTED_FAIL : 0)) * 0.5;
            break;
          case 'local':
            if (spread) {
              const pp = Math.min(1, p + BASE_DISTRIBUTED_FAIL);
              o.committed = rate * (1 - pp);
              o.rolledBack = rate * pp * 0.5;
              vRate = rate * pp * 0.5;
            } else {
              o.committed = rate * (1 - p);
              o.rolledBack = rate * p;
            }
            break;
          case '2pc':
            if (this.coordinatorDown(ep)) {
              o.stuck = rate;
              for (const s of txSteps(ep))
                if (s.type === 'dbWrite' && s.targetId) this.addStuckLocks(s.targetId, rate * dt);
            } else {
              o.committed = rate * (1 - p);
              o.rolledBack = rate * p;
            }
            break;
          case 'sagaOrchestration':
          case 'tcc':
            if (this.coordinatorDown(ep)) o.stuck = rate;
            else {
              o.committed = rate * (1 - p);
              o.compensated = rate * p;
              if (tx.pattern === 'sagaOrchestration') {
                vRate = rate * p * 0.015;
                vKind = 'isolation';
              }
            }
            break;
          case 'sagaChoreography': {
            o.committed = rate * (1 - p);
            o.compensated = rate * p;
            const dup = this.dupFraction(ep);
            if (!tx.options.idempotentConsumers && dup > 0) {
              vRate += rate * dup;
              vKind = 'dup';
            }
            if (!tx.options.outbox) {
              const crash = Math.min(1, this.st(ep.serviceId).err + 0.0005);
              vRate += rate * crash * 0.3;
              if (vKind !== 'dup') vKind = 'lost';
            }
            break;
          }
        }
        if (o.compensated > 0) this.markCompensation(ep, o.compensated, eacc);
      }
      o.violated = vRate;
      outcomesByEp.set(ep.id, o);
      if (vRate > 0) this.emitViolations(ep, vRate * dt, vKind, violations);

      if (clientFacing.has(ep.id) || tx) {
        g.committed += o.committed;
        g.rolledBack += o.rolledBack;
        g.compensated += o.compensated;
        g.stuck += o.stuck;
        g.failed += o.failed;
        g.msgs += r.msgs * rate;
        g.txs += rate;
      }
      if (clientFacing.has(ep.id)) {
        g.thr += o.committed;
        g.err += o.failed + o.rolledBack + o.stuck;
        g.lat += r.lat * rate;
        g.p99 += r.lat * (2.2 + Math.min(2, this.maxLoadOf(ep))) * rate;
        g.w += rate;
      }
    }

    // Зависшие блокировки отпускаются, когда координаторы снова в строю.
    const anyCoordinatorDown = this.schema.endpoints.some(
      (ep) => ep.transaction?.pattern === '2pc' && this.coordinatorDown(ep) && (epRate.get(ep.id) ?? 0) > 0,
    );
    for (const n of this.schema.nodes) {
      const s = this.st(n.id);
      if (!anyCoordinatorDown) s.stuckLocks *= Math.exp(-dt / 2);
      if (s.stuckLocks < 0.5) s.stuckLocks = 0;
    }

    // Активные блокировки БД по закону Литтла.
    for (const n of this.schema.nodes) if (n.kind === 'database') this.st(n.id).locks = this.st(n.id).stuckLocks;
    for (const ep of this.schema.endpoints) {
      const rate = epRate.get(ep.id) ?? 0;
      if (!rate || !ep.transaction) continue;
      const hold = (ep.transaction.pattern === '2pc' || ep.transaction.pattern === 'local' ? this.lockHoldMs(ep) : 3) / 1000;
      for (const s of txSteps(ep))
        if (s.type === 'dbWrite' && s.targetId) {
          const st = this.state.get(s.targetId);
          if (st) st.locks += rate * hold;
        }
    }

    /* ---- Сборка сообщений ---- */
    const nodesOut: Record<string, NodeMetrics> = {};
    for (const n of this.schema.nodes) {
      const s = this.st(n.id);
      const down = this.isDown(n.id);
      const noise = jitter(this.rng, 0.04);
      nodesOut[n.id] = {
        rps: round(s.lambda * (1 - s.err) * noise, 1),
        load: round(s.load, 3),
        queue: Math.round(s.q),
        p50: round(s.W * 0.85 * noise, 2),
        p99: round(s.W * (2.3 + Math.min(s.load, 2)) * noise, 2),
        errorsPerS: round(s.lambda * s.err, 1),
        locks: n.kind === 'database' ? Math.round(s.locks) : undefined,
        lagMs: n.role === 'replica' ? Math.round(s.lagMs) : undefined,
        backlog: n.kind === 'broker' ? Math.round(s.backlog) : undefined,
        down,
      };
    }
    const edgesOut: Record<string, EdgeMetrics> = {};
    for (const e of this.schema.edges) {
      const a = eacc.get(e.id);
      const tgt = this.state.get(e.target);
      const extra = this.edgeExtra(e);
      const errFrac = Math.min(1, (tgt?.err ?? 0) + extra.loss);
      edgesOut[e.id] = {
        rps: round(a?.rps ?? 0, 1),
        errorsPerS: round((a?.rps ?? 0) * errFrac, 1),
        lagMs: e.kind === 'replication' ? Math.round(this.st(e.target).lagMs) : undefined,
      };
    }
    const latMean = g.w > 0 ? g.lat / g.w : 0;
    const global: GlobalMetrics = {
      throughput: round(g.thr, 1),
      p50: round(latMean * 0.85, 2),
      p95: round(latMean * 1.9, 2),
      p99: round(g.w > 0 ? g.p99 / g.w : 0, 2),
      errorsPerS: round(g.err, 1),
      committed: round(g.committed, 1),
      rolledBack: round(g.rolledBack, 1),
      compensated: round(g.compensated, 1),
      stuck: round(g.stuck, 1),
      failed: round(g.failed, 1),
      violationsTotal: this.violationsTotal,
      messagesPerTx: round(g.txs > 0 ? g.msgs / g.txs : 0, 2),
    };

    const recentTx = this.sampleTx(epRate, outcomesByEp, dt);
    return {
      tick: { type: 'tick', t: round(this.t, 3), nodes: nodesOut, edges: edgesOut, global, recentTx },
      flows: realDtMs > 0 ? this.sampleFlows(eacc, realDtMs, speed) : [],
      alerts: this.evaluateAlerts(),
      violations,
    };
  }

  /* ---------------- Вспомогательное ---------------- */

  private st(id: string): NodeState {
    let s = this.state.get(id);
    if (!s) {
      s = { q: 0, backlog: 0, stuckLocks: 0, lambda: 0, mu: 1, costMs: 1, W: 1, err: 0, load: 0, locks: 0, lagMs: 0 };
      this.state.set(id, s);
    }
    return s;
  }

  private pathCache = new Map<string, string[] | null>();
  private pathSchema: Schema | null = null;
  private pathTo(clientId: string, serviceId: string): string[] | null {
    if (this.pathSchema !== this.schema) {
      this.pathCache.clear();
      this.pathSchema = this.schema;
    }
    const key = `${clientId}>${serviceId}`;
    if (!this.pathCache.has(key)) {
      // BFS по транзитным узлам; сам путь считается в analysis.clientPath.
      const prev = new Map<string, string>();
      const queue = [clientId];
      const seen = new Set(queue);
      let found: string[] | null = null;
      while (queue.length && !found) {
        const cur = queue.shift()!;
        for (const e of this.schema.edges) {
          if (e.source !== cur || e.kind !== 'call' || seen.has(e.target)) continue;
          const n = this.nodes.get(e.target);
          if (!n) continue;
          prev.set(n.id, cur);
          seen.add(n.id);
          if (n.id === serviceId) {
            const path = [n.id];
            let p = cur;
            while (p !== clientId) {
              path.push(p);
              p = prev.get(p)!;
            }
            path.push(clientId);
            found = path.reverse();
            break;
          }
          if (n.kind === 'gateway' || n.kind === 'balancer') queue.push(n.id);
        }
      }
      this.pathCache.set(key, found);
    }
    return this.pathCache.get(key) ?? null;
  }

  private baseCost(n: SchemaNode): number {
    switch (n.kind) {
      case 'service':
        return numParam(n.params, 'service', 'baseMs');
      case 'database':
        return numParam(n.params, 'database', 'readMs');
      case 'gateway':
        return numParam(n.params, 'gateway', 'routingMs');
      case 'broker':
        return numParam(n.params, 'broker', 'deliveryMs');
      default:
        return 0.2;
    }
  }

  private capacity(n: SchemaNode, s: NodeState): number {
    const cost = Math.max(0.05, s.costMs);
    switch (n.kind) {
      case 'service':
        return (numParam(n.params, 'service', 'instances') * numParam(n.params, 'service', 'workers') * 1000) / cost;
      case 'database': {
        if (n.scaling?.sharding) return 200000;
        const pool = numParam(n.params, 'database', 'pool');
        const eff = pool * Math.max(0.05, 1 - s.stuckLocks / (s.stuckLocks + 150));
        const partitions = n.scaling?.partitioning ? Math.min(1.35, 1 + n.scaling.partitioning.count * 0.03) : 1;
        const iso = strParam(n.params, 'database', 'isolation');
        const isoK = iso === 'serializable' ? 0.75 : iso === 'repeatableRead' ? 0.9 : 1;
        return ((eff * 1000) / cost) * partitions * isoK;
      }
      case 'broker':
        return numParam(n.params, 'broker', 'throughput');
      case 'gateway':
        return Math.min(
          (numParam(n.params, 'gateway', 'workers') * 1000) / Math.max(0.1, cost),
          numParam(n.params, 'gateway', 'rpsLimit'),
        );
      case 'cache':
        return 50000;
      case 'balancer':
        return 100000;
      case 'client':
        return Infinity;
    }
  }

  /** Сквозная задержка и вероятность отказа эндпоинта. */
  private endpointResult(ep: Endpoint, depth: number, rec: (ep: Endpoint, depth: number) => EpResult): EpResult {
    const svc = this.st(ep.serviceId);
    if (this.isDown(ep.serviceId)) return { lat: 0, pFail: 1, msgs: 1 };
    let lat = svc.W;
    let ok = 1 - svc.err;
    let msgs = 0;
    let maxNet = 0;
    let writeMs = 0;
    const tx = ep.transaction;
    const inTx = new Set(txSteps(ep).map((s) => s.id));
    const participants = new Set<string>();
    for (const s of ep.steps) {
      if (!s.targetId) continue;
      const edge = this.edgeByPair.get(`${ep.serviceId}>${s.targetId}`);
      const net = this.edgeExtra(edge);
      maxNet = Math.max(maxNet, net.delay);
      ok *= 1 - net.loss;
      if (inTx.has(s.id)) participants.add(s.targetId);
      switch (s.type) {
        case 'dbRead':
        case 'dbWrite': {
          const { W, err } = this.dbLatency(s.targetId, s.type === 'dbWrite');
          lat += 2 * net.delay + W;
          ok *= 1 - err;
          msgs += 1;
          // Фазы 2PC — это собственные записи участников (журнал prepare/commit), без очереди.
          if (s.type === 'dbWrite') writeMs = Math.max(writeMs, numParam(this.nodes.get(s.targetId)?.params ?? {}, 'database', 'writeMs'));
          break;
        }
        case 'cacheRead':
        case 'cacheWrite':
          lat += 2 * net.delay + this.st(s.targetId).W;
          ok *= 1 - this.st(s.targetId).err;
          msgs += 1;
          break;
        case 'call': {
          const callee = s.targetEndpointId ? this.epById.get(s.targetEndpointId) : undefined;
          msgs += 2;
          if (callee && depth < 6) {
            const r = rec(callee, depth + 1);
            lat += 2 * net.delay + r.lat;
            const retries = numParam(this.nodes.get(ep.serviceId)?.params ?? {}, 'service', 'retries');
            ok *= 1 - Math.pow(Math.min(1, r.pFail), 1 + retries);
            msgs += r.msgs;
          } else {
            lat += 2 * net.delay + this.st(s.targetId).W;
            ok *= 1 - this.st(s.targetId).err;
          }
          break;
        }
        case 'publish': {
          const broker = this.st(s.targetId);
          lat += net.delay + 0.5;
          ok *= this.isDown(s.targetId) ? 0 : 1;
          msgs += 1;
          if (tx?.pattern === 'sagaChoreography' && inTx.has(s.id) && s.topic && depth < 6) {
            for (const sub of subscribersOf(this.schema, s.topic)) {
              const r = rec(sub, depth + 1);
              lat += broker.W + r.lat + (tx.options.idempotentConsumers ? 1 : 0);
              ok *= 1 - r.pFail;
              msgs += 1 + r.msgs;
            }
          }
          break;
        }
        default:
          break;
      }
    }
    if (tx) {
      const n = Math.max(1, participants.size);
      switch (tx.pattern) {
        case '2pc':
          lat += 2 * (2 * maxNet + writeMs) + 2;
          msgs += 4 * n;
          break;
        case 'sagaOrchestration':
          lat += txSteps(ep).length * 1.5;
          msgs += txSteps(ep).length;
          break;
        case 'tcc':
          lat += 2 * maxNet + writeMs;
          msgs += 2 * n;
          break;
        case 'sagaChoreography':
          if (tx.options.outbox) lat += 1;
          break;
        default:
          break;
      }
      if (tx.options.outbox && tx.pattern !== 'sagaChoreography') lat += 1;
    }
    // Запрос дольше таймаута клиента всё равно обрывается — задержка не растёт бесконечно.
    lat = Math.min(lat, MAX_LATENCY_MS) * jitter(this.rng, 0.03);
    return { lat, pFail: 1 - ok, msgs };
  }

  /**
   * Сколько транзакция держит блокировки: всё время протокола, но не дольше таймаута фазы —
   * по таймауту участник откатывает свою часть (иначе задержка и блокировки разгоняют друг друга).
   */
  private lockHoldMs(ep: Endpoint): number {
    const timeout = ep.transaction?.options.phaseTimeoutMs ?? 500;
    return Math.min(this.epLatPrev.get(ep.id) ?? 10, Math.max(10, timeout));
  }

  private dbLatency(dbId: string, write: boolean): { W: number; err: number } {
    const db = this.nodes.get(dbId);
    if (!db) return { W: 0, err: 1 };
    if (this.isDown(dbId)) return { W: 0, err: 1 };
    const shards = db.scaling?.sharding ? derivedNodes(this.schema, dbId, 'shard') : [];
    const phys = shards.length ? shards : [db];
    let W = 0;
    let err = 0;
    for (const p of phys) {
      const ps = this.st(p.id);
      const repl = p.scaling?.replication;
      const replicas = repl ? derivedNodes(this.schema, p.id, 'replica').filter((r) => !this.isDown(r.id)) : [];
      let w = ps.W;
      let e = this.isDown(p.id) ? 1 : ps.err;
      if (!write && repl?.readPolicy === 'replicas' && replicas.length) {
        w = replicas.reduce((a, r) => a + this.st(r.id).W, 0) / replicas.length;
        e = replicas.reduce((a, r) => a + this.st(r.id).err, 0) / replicas.length;
      }
      if (write && repl?.mode === 'sync' && replicas.length) w += repl.lagMs * 0.1 + 1;
      W += w;
      err += e;
    }
    return { W: W / phys.length + (shards.length ? 0.2 : 0), err: err / phys.length };
  }

  private maxLoadOf(ep: Endpoint): number {
    let m = this.st(ep.serviceId).load;
    for (const s of ep.steps) if (s.targetId) m = Math.max(m, this.st(s.targetId).load);
    return m;
  }

  private dupFraction(ep: Endpoint): number {
    let dup = 0;
    for (const s of txSteps(ep)) {
      if (s.type !== 'publish' || !s.targetId || !s.topic) continue;
      const broker = this.nodes.get(s.targetId);
      if (!broker) continue;
      dup += numParam(broker.params, 'broker', 'duplicatePct') / 100;
      for (const sub of subscribersOf(this.schema, s.topic))
        dup += this.edgeExtra(this.edgeByPair.get(`${broker.id}>${sub.serviceId}`)).dup;
      dup += this.edgeExtra(this.edgeByPair.get(`${ep.serviceId}>${broker.id}`)).dup;
    }
    return Math.min(1, dup);
  }

  private addStuckLocks(dbId: string, n: number) {
    const db = this.nodes.get(dbId);
    if (!db) return;
    const shards = db.scaling?.sharding ? derivedNodes(this.schema, dbId, 'shard') : [];
    const phys = shards.length ? shards : [db];
    for (const p of phys) {
      const s = this.st(p.id);
      s.stuckLocks = Math.min(5000, s.stuckLocks + n / phys.length);
    }
  }

  private markCompensation(ep: Endpoint, rate: number, eacc: Map<string, { rps: number; comp: number }>) {
    for (const s of txSteps(ep)) {
      if (!s.targetId) continue;
      const e = this.edgeByPair.get(`${ep.serviceId}>${s.targetId}`);
      if (!e) continue;
      const a = eacc.get(e.id) ?? { rps: 0, comp: 0 };
      a.comp += rate;
      eacc.set(e.id, a);
    }
  }

  private emitViolations(ep: Endpoint, expected: number, kind: 'partial' | 'dup' | 'isolation' | 'lost', out: ViolationMsg[]) {
    const prefer: Record<typeof kind, InvariantType[]> = {
      partial: ['moneyConserved', 'paidReserved', 'nonNegative'],
      dup: ['exactlyOnceDebit', 'moneyConserved', 'nonNegative'],
      isolation: ['paidReserved', 'nonNegative', 'moneyConserved'],
      lost: ['paidReserved', 'exactlyOnceDebit', 'moneyConserved'],
    };
    const inv =
      prefer[kind].map((t) => this.schema.invariants.find((i) => i.type === t)).find(Boolean) ?? this.schema.invariants[0];
    if (!inv) return;
    const carry = (this.violationCarry.get(ep.id) ?? 0) + expected;
    const n = Math.floor(carry);
    this.violationCarry.set(ep.id, carry - n);
    this.violationsTotal += n;
    for (let i = 0; i < Math.min(n, 10); i++) {
      const txId = this.nextTxId();
      const target = txSteps(ep).find((s) => s.type === 'dbWrite')?.targetId ?? undefined;
      out.push({ type: 'violation', t: round(this.t, 2), invariantId: inv.id, txId, nodeId: target });
      this.recordTx(
        { txId, endpointId: ep.id, t: round(this.t, 2), durationMs: round(this.epLatPrev.get(ep.id) ?? 10, 1), outcome: 'violated' },
        ep,
      );
    }
  }

  private nextTxId(): string {
    this.txSeq += 1;
    return `tx-${this.txSeq.toString(36).padStart(5, '0')}`;
  }

  private recordTx(summary: TxSummary, ep: Endpoint) {
    const W: Record<string, number> = {};
    W[ep.serviceId] = this.st(ep.serviceId).W;
    for (const s of ep.steps) if (s.targetId) W[s.targetId] = this.st(s.targetId).W;
    this.txLog.push({ summary, W, failAt: Math.floor(this.rng() * Math.max(1, ep.steps.length)) });
    if (this.txLog.length > 300) this.txLog.splice(0, this.txLog.length - 300);
  }

  private sampleTx(epRate: Map<string, number>, outcomes: Map<string, Record<TxOutcome, number>>, dt: number): TxSummary[] {
    const eps = this.schema.endpoints.filter((e) => (epRate.get(e.id) ?? 0) > 0);
    if (!eps.length) return [];
    this.txSampleCarry += dt * 3;
    const out: TxSummary[] = [];
    while (this.txSampleCarry >= 1) {
      this.txSampleCarry -= 1;
      const total = eps.reduce((a, e) => a + (epRate.get(e.id) ?? 0), 0);
      let x = this.rng() * total;
      let ep = eps[0];
      for (const e of eps) {
        x -= epRate.get(e.id) ?? 0;
        if (x <= 0) {
          ep = e;
          break;
        }
      }
      const o = outcomes.get(ep.id);
      let outcome: TxOutcome = 'committed';
      if (o) {
        const sum = Object.values(o).reduce((a, b) => a + b, 0) - o.violated;
        // Чтобы в списке было что посмотреть, редкие исходы показываются чуть чаще реального.
        const boost = (v: number) => Math.min(sum, v * 6);
        let y = this.rng() * sum;
        for (const k of ['rolledBack', 'compensated', 'stuck', 'failed'] as const) {
          y -= boost(o[k]);
          if (y <= 0) {
            outcome = k;
            break;
          }
        }
      }
      const lat = Math.min(this.epLatPrev.get(ep.id) ?? 10, MAX_LATENCY_MS) * jitter(this.rng, 0.25);
      const summary: TxSummary = {
        txId: this.nextTxId(),
        endpointId: ep.id,
        t: round(this.t, 2),
        durationMs: round(outcome === 'stuck' ? Math.max(Math.min(lat, MAX_LATENCY_MS), (ep.transaction?.options.phaseTimeoutMs ?? 500) * 4) : lat, 1),
        outcome,
      };
      this.recordTx(summary, ep);
      out.push(summary);
    }
    return out;
  }

  private sampleFlows(eacc: Map<string, { rps: number; comp: number }>, realDtMs: number, speed: number): FlowItem[] {
    const items: FlowItem[] = [];
    const edges = [...eacc.entries()].filter(([, a]) => a.rps > 0.01);
    if (!edges.length) return items;
    const weights = edges.map(([, a]) => Math.sqrt(a.rps));
    const total = weights.reduce((a, b) => a + b, 0);
    this.flowCarry += (FLOWS_PER_REAL_S * realDtMs) / 1000;
    const n = Math.floor(this.flowCarry);
    this.flowCarry -= n;
    const travel = 650 / Math.max(1, Math.log10(Math.max(1, speed)) + 1);
    for (let i = 0; i < n; i++) {
      let x = this.rng() * total;
      let k = 0;
      while (k < edges.length - 1 && x > weights[k]) x -= weights[k++];
      const [edgeId, a] = edges[k];
      const edge = this.schema.edges.find((e) => e.id === edgeId);
      if (!edge) continue;
      const src = this.nodes.get(edge.source);
      const tgt = this.nodes.get(edge.target);
      const extra = this.edgeExtra(edge);
      const errFrac = Math.min(1, (this.state.get(edge.target)?.err ?? 0) + extra.loss);
      const isMsg = src?.kind === 'broker' || tgt?.kind === 'broker';
      const isComp = a.comp > 0 && this.rng() < Math.min(0.6, (a.comp / a.rps) * 4);
      const outcome = this.rng() < errFrac ? 'error' : 'ok';
      const delayMs = this.rng() * realDtMs;
      const dur = travel * jitter(this.rng, 0.15) + Math.min(400, extra.delay * 2);
      if (edge.kind !== 'call') {
        items.push({ edgeId, dir: 'fwd', kind: 'message', outcome: 'ok', durationMs: dur, delayMs });
        continue;
      }
      items.push({
        edgeId,
        dir: 'fwd',
        kind: isComp ? 'compensation' : isMsg ? 'message' : 'request',
        outcome,
        durationMs: dur,
        delayMs,
      });
      if (!isMsg && outcome === 'ok' && tgt?.kind !== 'broker')
        items.push({ edgeId, dir: 'back', kind: 'response', outcome: 'ok', durationMs: dur, delayMs: delayMs + dur + 60 });
    }
    return items;
  }

  /* ---------------- Подсказки (alert) ---------------- */

  private evaluateAlerts(): AlertMsg[] {
    const want = new Map<string, { code: AlertCode; nodeId: string; params: Record<string, string | number> }>();
    const put = (code: AlertCode, nodeId: string, params: Record<string, string | number>) =>
      want.set(`${code}|${nodeId}`, { code, nodeId, params });

    for (const n of this.schema.nodes) {
      const s = this.st(n.id);
      const key = (c: AlertCode) => this.alertsOn.has(`${c}|${n.id}`);
      if (this.isDown(n.id)) {
        put('nodeDown', n.id, { name: n.name });
        continue;
      }
      const hot = (c: AlertCode) => s.load > 0.9 || (key(c) && s.load > 0.8);
      if (n.kind === 'database' && !n.scaling?.sharding && hot('dbOverload'))
        put('dbOverload', n.id, { name: n.name, queue: Math.round(s.q), load: Math.round(s.load * 100) });
      if (n.kind === 'service' && hot('serviceOverload'))
        put('serviceOverload', n.id, { name: n.name, queue: Math.round(s.q), load: Math.round(s.load * 100) });
      if (n.kind === 'broker' && (s.backlog > 1000 || (key('brokerBacklog') && s.backlog > 200)))
        put('brokerBacklog', n.id, { name: n.name, backlog: Math.round(s.backlog) });
      if (n.role === 'replica' && (s.lagMs > 1000 || (key('replicaLag') && s.lagMs > 500)))
        put('replicaLag', n.id, { name: n.name, lag: Math.round(s.lagMs) });
      if (n.kind === 'database' && s.stuckLocks > 30) put('locksStuck', n.id, { name: n.name, locks: Math.round(s.stuckLocks) });
    }
    for (const ep of this.schema.endpoints) {
      const tx = ep.transaction;
      if (!tx || !(this.epRate.get(ep.id) ?? 0)) continue;
      if ((tx.pattern === '2pc' || tx.pattern === 'sagaOrchestration' || tx.pattern === 'tcc') && this.coordinatorDown(ep))
        put('coordinatorDown', tx.coordinatorId ?? ep.serviceId, { name: this.nodes.get(tx.coordinatorId ?? ep.serviceId)?.name ?? '', endpoint: ep.name });
      const spread = txNeedsDistributedPattern(this.schema, ep);
      if (spread) {
        const db = txSteps(ep).find((s) => s.type === 'dbWrite' && s.targetId)?.targetId;
        if (db) put('crossShardTx', db, { name: this.nodes.get(db)?.name ?? '', endpoint: ep.name, endpointId: ep.id });
      }
      if (tx.pattern === 'sagaChoreography' && !tx.options.idempotentConsumers && this.dupFraction(ep) > 0) {
        const broker = txSteps(ep).find((s) => s.type === 'publish')?.targetId;
        if (broker) put('duplicateDelivery', broker, { name: this.nodes.get(broker)?.name ?? '', endpoint: ep.name, endpointId: ep.id });
      }
    }

    const out: AlertMsg[] = [];
    for (const [k, a] of want)
      if (!this.alertsOn.has(k)) {
        this.alertsOn.add(k);
        out.push({ type: 'alert', t: round(this.t, 2), active: true, ...a });
      }
    for (const k of [...this.alertsOn])
      if (!want.has(k)) {
        this.alertsOn.delete(k);
        const [code, nodeId] = k.split('|');
        out.push({ type: 'alert', t: round(this.t, 2), code: code as AlertCode, nodeId, active: false, params: {} });
      }
    return out;
  }

  /* ---------------- Трассировка (5.11) ---------------- */

  getTrace(txId: string): TraceMsg | null {
    const rec = this.txLog.find((r) => r.summary.txId === txId);
    if (!rec) return null;
    const ep = this.epById.get(rec.summary.endpointId);
    if (!ep) return null;
    const spans: TraceSpan[] = [];
    const outcome = rec.summary.outcome;
    const tx = ep.transaction;
    const failing = outcome === 'compensated' || outcome === 'rolledBack' || outcome === 'failed';
    const lockStarts: { nodeId: string; start: number }[] = [];
    let cur = 0;
    const W = (id: string) => rec.W[id] ?? this.st(id).W ?? 1;
    const push = (nodeId: string, label: string, kind: TraceSpan['kind'], dur: number) => {
      const d = Math.max(0.05, dur);
      spans.push({ nodeId, label, kind, startMs: round(cur, 2), endMs: round(cur + d, 2) });
      cur += d;
    };
    push(ep.serviceId, 'handle', 'work', Math.max(0.3, this.st(ep.serviceId).costMs));
    const done: Step[] = [];
    const walk = (e: Endpoint, depth: number, inTx: Set<string>) => {
      for (const [i, s] of e.steps.entries()) {
        if (failing && depth === 0 && i > rec.failAt) break;
        if (!s.targetId && s.type !== 'compute') continue;
        const net = this.edgeExtra(this.edgeByPair.get(`${e.serviceId}>${s.targetId}`)).delay;
        const label = s.action ? `${s.type}:${s.action}` : s.type;
        if (s.type === 'compute') {
          push(e.serviceId, 'compute', 'work', s.durationMs);
          continue;
        }
        const tid = s.targetId!;
        if (net > 0) push(tid, 'network', 'network', net);
        const w = W(tid);
        const cost = Math.min(w, Math.max(0.2, this.st(tid).costMs));
        if (w - cost > 0.3) push(tid, 'queue', 'queue', w - cost);
        if (tx?.pattern === '2pc' && depth === 0 && s.type === 'dbWrite' && inTx.has(s.id))
          lockStarts.push({ nodeId: tid, start: cur });
        if (s.type === 'call' && s.targetEndpointId && depth < 3) {
          const callee = this.epById.get(s.targetEndpointId);
          push(tid, 'handle', 'work', cost);
          if (callee) walk(callee, depth + 1, new Set());
        } else if (s.type === 'publish') {
          push(tid, label, 'work', 0.5);
          if (tx?.pattern === 'sagaChoreography' && s.topic && depth < 3)
            for (const sub of subscribersOf(this.schema, s.topic)) {
              push(tid, 'deliver', 'network', Math.max(0.5, W(tid)));
              push(sub.serviceId, 'handle', 'work', Math.max(0.3, this.st(sub.serviceId).costMs));
              walk(sub, depth + 1, new Set());
            }
        } else push(tid, label, 'work', cost);
        if (depth === 0 && inTx.has(s.id)) done.push(s);
      }
    };
    walk(ep, 0, new Set(txSteps(ep).map((s) => s.id)));

    if (tx?.pattern === '2pc') {
      const coord = tx.coordinatorId ?? ep.serviceId;
      push(coord, 'prepare', 'work', 2);
      if (outcome === 'stuck') push(coord, 'waitCoordinator', 'queue', Math.max(50, rec.summary.durationMs - cur));
      else push(coord, outcome === 'rolledBack' ? 'rollback' : 'commit', 'work', 2);
      for (const l of lockStarts) spans.push({ nodeId: l.nodeId, label: 'lock', kind: 'lock', startMs: round(l.start, 2), endMs: round(cur, 2) });
    } else if (outcome === 'stuck') {
      push(tx?.coordinatorId ?? ep.serviceId, 'waitCoordinator', 'queue', Math.max(50, rec.summary.durationMs - cur));
    }
    if (outcome === 'compensated') {
      for (const s of [...done].reverse()) {
        const a = getAction(s.action);
        if (!a?.compensation || !s.targetId) continue;
        push(s.targetId, `compensate:${a.compensation}`, 'compensation', s.compensationDurationMs ?? Math.max(1, this.st(s.targetId).costMs));
      }
    }
    return { type: 'trace', txId, endpointId: ep.id, outcome, spans };
  }
}

function round(v: number, digits: number): number {
  if (!Number.isFinite(v)) return 0;
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}
