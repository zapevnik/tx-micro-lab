/**
 * Контроллер запуска: связывает EngineClient с хранилищами.
 * - команды пользователя → команды движка (6.3);
 * - поток сообщений движка → useSim / flowBus;
 * - изменения схемы во время запуска → patch + вертикальная метка на графиках (5.8).
 */
import { getEngine } from '@/engine';
import type { EngineMessage } from '@/engine/types';
import { t, tMaybe } from '@/i18n';
import { nodeById } from '@/schema/analysis';
import { newId } from '@/schema/ids';
import { updateWorkload } from '@/schema/ops';
import type { FaultAction, Schema } from '@/schema/types';
import { hasErrors } from '@/schema/validate';
import { project, useProject } from '@/store/project';
import { alertKey, sim } from '@/store/sim';
import { ui } from '@/store/ui';
import { flowBus } from './flowBus';

let patchTimer: ReturnType<typeof setTimeout> | null = null;

export function initSimController(): () => void {
  const engine = getEngine();
  const offMsg = engine.onMessage(handleMessage);
  const offStatus = engine.onStatus((s) => sim().setConnection(s));
  const offProject = useProject.subscribe((s, prev) => {
    if (s.projectId !== prev.projectId) {
      if (sim().status !== 'idle') stop();
      sim().reset();
      for (const id of Object.keys(sim().faults)) sim().removeFault(id);
      return;
    }
    if (s.revision === prev.revision || sim().status === 'idle') return;
    if (patchTimer) clearTimeout(patchTimer);
    patchTimer = setTimeout(() => {
      patchTimer = null;
      if (sim().status === 'idle') return;
      engine.send({ type: 'patch', schema: project().schema });
      sim().addMarker(t('sim.changeMarker'));
      sim().addLog('change', t('sim.runtimeChange'));
    }, 350);
  });
  return () => {
    offMsg();
    offStatus();
    offProject();
  };
}

function handleMessage(msg: EngineMessage) {
  const s = sim();
  switch (msg.type) {
    case 'tick':
      s.applyTick(msg);
      flushViolations();
      break;
    case 'flows':
      flowBus.emit(msg.items);
      break;
    case 'alert': {
      s.setAlert(msg);
      const text = tMaybe(`alerts.${msg.code}.title`, msg.params, msg.code);
      if (msg.active) s.addLog('alert', text, msg.nodeId);
      else {
        // Проблема ушла — если появится снова, подсказку нужно показать заново.
        s.undismissAlert(alertKey(msg));
        s.addLog('resolved', nodeName(msg.nodeId), msg.nodeId);
      }
      break;
    }
    case 'violation': {
      // Нарушения копятся до ближайшего tick и пишутся в журнал одной строкой на инвариант.
      const b = pendingViolations.get(msg.invariantId) ?? { n: 0, tx: msg.txId, nodeId: msg.nodeId };
      b.n += 1;
      pendingViolations.set(msg.invariantId, b);
      break;
    }
    case 'trace':
      s.setTrace(msg);
      break;
    case 'finished':
      s.setStatus('idle');
      break;
    case 'error':
      s.addLog('error', `${msg.code}: ${msg.message}`);
      if (msg.code !== 'traceNotFound') ui().toast(msg.message, 'error');
      break;
  }
}

const pendingViolations = new Map<string, { n: number; tx: string; nodeId?: string }>();

function flushViolations() {
  for (const [invId, b] of pendingViolations) {
    const inv = project().schema.invariants.find((i) => i.id === invId);
    const invariant = inv ? t(`invariants.types.${inv.type}`) : invId;
    sim().addLog(
      'violation',
      b.n > 1 ? t('log.violationMany', { invariant, tx: b.tx, n: b.n }) : t('log.violation', { invariant, tx: b.tx }),
      b.nodeId,
    );
  }
  pendingViolations.clear();
}

function nodeName(id: string | undefined): string {
  return nodeById(project().schema, id)?.name ?? id ?? '';
}

/* ---------------- Управление запуском (5.8) ---------------- */

export function start() {
  const { schema, issues } = project();
  if (hasErrors(issues)) {
    ui().toast(t('topbar.cannotStart', { n: issues.filter((i) => i.severity === 'error').length }), 'error');
    return;
  }
  const engine = getEngine();
  sim().reset();
  engine.send({ type: 'start', schema, speed: sim().speed });
  for (const f of Object.values(sim().faults)) engine.send({ type: 'injectFault', faultId: f.id, action: f.action });
  sim().setStatus('running');
  sim().addLog('run', t('log.started', { seed: schema.seed }));
}

export function pause() {
  getEngine().send({ type: 'pause' });
  sim().setStatus('paused');
}

export function resume() {
  getEngine().send({ type: 'resume' });
  sim().setStatus('running');
}

export function togglePlay() {
  const st = sim().status;
  if (st === 'idle') start();
  else if (st === 'running') pause();
  else resume();
}

export function stop() {
  if (sim().status === 'idle') return;
  getEngine().send({ type: 'stop' });
  sim().setStatus('idle');
  sim().addLog('run', t('log.stopped'));
}

/** «Сброс»: остановить и очистить все данные запуска и отказы. */
export function resetRun() {
  stop();
  sim().reset();
  for (const id of Object.keys(sim().faults)) clearFault(id);
  flowBus.emit([]);
}

export function setSpeed(speed: number) {
  sim().setSpeed(speed);
  if (sim().status !== 'idle') getEngine().send({ type: 'setSpeed', speed });
}

/* ---------------- Нагрузка (5.7) ---------------- */

let rpsBefore: Schema | null = null;

/** Ползунок RPS: во время перетаскивания — без истории, по отпусканию — одна запись в истории. */
export function setClientRps(clientId: string, rps: number, commit: boolean) {
  const p = project();
  if (!rpsBefore) rpsBefore = p.schema;
  p.apply((s) => updateWorkload(s, clientId, { rps }), { history: false });
  if (sim().status !== 'idle') getEngine().send({ type: 'setLoad', clientId, rps });
  if (commit) {
    p.pushHistory(rpsBefore);
    rpsBefore = null;
  }
}

/* ---------------- Отказы (5.10) ---------------- */

export function describeFault(action: FaultAction, schema: Schema): string {
  const what = t(`chaos.types.${action.type}`);
  let target = '';
  if ('nodeId' in action) target = nodeById(schema, action.nodeId)?.name ?? action.nodeId;
  else if ('edgeId' in action) {
    const e = schema.edges.find((x) => x.id === action.edgeId);
    target = e ? `${nodeById(schema, e.source)?.name ?? '?'} → ${nodeById(schema, e.target)?.name ?? '?'}` : action.edgeId;
  } else target = schema.endpoints.find((e) => e.id === action.endpointId)?.name ?? action.endpointId;
  let value = '';
  if (action.type === 'nodeSlow') value = ` ×${action.factor}`;
  if (action.type === 'linkDelay') value = ` +${action.delayMs} ${t('units.ms')}`;
  if (action.type === 'linkLoss' || action.type === 'linkDuplicate') value = ` ${action.pct}%`;
  if (action.type === 'coordinatorCrash')
    value = action.after === 'prepare' ? ' (prepare)' : ` (#${(action.stepIndex ?? 0) + 1})`;
  return `${what}: ${target}${value}`;
}

export function injectFault(action: FaultAction) {
  const id = newId('f');
  sim().setFault({ id, action });
  if (sim().status !== 'idle') {
    getEngine().send({ type: 'injectFault', faultId: id, action });
    sim().addMarker(t(`chaos.types.${action.type}`));
  }
  sim().addLog('fault', describeFault(action, project().schema), 'nodeId' in action ? action.nodeId : undefined);
}

export function clearFault(id: string) {
  const f = sim().faults[id];
  if (!f) return;
  sim().removeFault(id);
  if (sim().status !== 'idle') {
    getEngine().send({ type: 'clearFault', faultId: id });
    sim().addMarker(t('chaos.enable'));
  }
  sim().addLog('fault', t('log.faultOff', { target: describeFault(f.action, project().schema) }));
}

/** Снять все отказы, наложенные на узел или связь (и, опционально, только определённого типа). */
export function clearFaultsFor(target: { nodeId?: string; edgeId?: string; endpointId?: string }, type?: FaultAction['type']) {
  for (const f of Object.values(sim().faults)) {
    const a = f.action;
    const hit =
      (target.nodeId && 'nodeId' in a && a.nodeId === target.nodeId) ||
      (target.edgeId && 'edgeId' in a && a.edgeId === target.edgeId) ||
      (target.endpointId && 'endpointId' in a && a.endpointId === target.endpointId);
    if (hit && (!type || a.type === type)) clearFault(f.id);
  }
}

export function faultsOnNode(nodeId: string): FaultAction[] {
  return Object.values(sim().faults)
    .map((f) => f.action)
    .filter((a) => 'nodeId' in a && a.nodeId === nodeId);
}

/* ---------------- Трассировка (5.11) ---------------- */

export function requestTrace(txId: string) {
  if (sim().traces[txId]) return;
  getEngine().send({ type: 'getTrace', txId });
}
