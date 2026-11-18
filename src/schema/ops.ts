/**
 * Операции редактирования схемы — чистые функции Schema → Schema.
 * Хранилище только вызывает их и кладёт результат в историю (отмена/повтор).
 */
import { compensationOf } from './dictionary';
import { ID_PREFIX, newId } from './ids';
import { defaultParams } from './params';
import { connectError, type ConnectError } from './rules';
import type {
  ClientWorkload,
  Endpoint,
  FaultAction,
  NodeKind,
  ParamValue,
  Schema,
  SchemaEdge,
  SchemaNode,
  Step,
  StepType,
  Transaction,
  Trigger,
  TxPattern,
} from './types';

/* ---------- Узлы ---------- */

export function createNode(kind: NodeKind, name: string, position: { x: number; y: number }): SchemaNode {
  return { id: newId(ID_PREFIX[kind]), kind, name, position, params: defaultParams(kind) };
}

export function addNode(schema: Schema, node: SchemaNode): Schema {
  const workload: ClientWorkload[] =
    node.kind === 'client'
      ? [...schema.workload, { clientId: node.id, profile: 'constant', rps: 100, mix: [] }]
      : schema.workload;
  return { ...schema, nodes: [...schema.nodes, node], workload };
}

export function updateNode(schema: Schema, id: string, patch: Partial<Omit<SchemaNode, 'id' | 'kind'>>): Schema {
  return { ...schema, nodes: schema.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}

export function setParam(schema: Schema, id: string, key: string, value: ParamValue): Schema {
  return {
    ...schema,
    nodes: schema.nodes.map((n) => (n.id === id ? { ...n, params: { ...n.params, [key]: value } } : n)),
  };
}

export function moveNodes(schema: Schema, positions: Record<string, { x: number; y: number }>): Schema {
  return {
    ...schema,
    nodes: schema.nodes.map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n)),
  };
}

function faultTouches(a: FaultAction, nodeIds: Set<string>, edgeIds: Set<string>, epIds: Set<string>): boolean {
  if ('nodeId' in a) return nodeIds.has(a.nodeId);
  if ('edgeId' in a) return edgeIds.has(a.edgeId);
  return epIds.has(a.endpointId);
}

/** Удаление узлов вместе со всем, что на них ссылается (5.1). */
export function removeNodes(schema: Schema, ids: string[]): Schema {
  const removed = new Set(ids);
  // Шарды и реплики уходят вместе с родительской БД.
  for (const n of schema.nodes) if (n.groupId && removed.has(n.groupId)) removed.add(n.id);

  const nodes = schema.nodes.filter((n) => !removed.has(n.id));
  const removedEdges = new Set(
    schema.edges.filter((e) => removed.has(e.source) || removed.has(e.target)).map((e) => e.id),
  );
  const edges = schema.edges.filter((e) => !removedEdges.has(e.id));
  const removedEps = new Set(schema.endpoints.filter((e) => removed.has(e.serviceId)).map((e) => e.id));
  const endpoints = schema.endpoints
    .filter((e) => !removedEps.has(e.id))
    .map((ep) => ({
      ...ep,
      steps: ep.steps.map((s) => ({
        ...s,
        targetId: s.targetId && removed.has(s.targetId) ? null : s.targetId,
        targetEndpointId: s.targetEndpointId && removedEps.has(s.targetEndpointId) ? null : s.targetEndpointId,
      })),
      transaction:
        ep.transaction && ep.transaction.coordinatorId && removed.has(ep.transaction.coordinatorId)
          ? { ...ep.transaction, coordinatorId: null }
          : ep.transaction,
    }));
  const workload = schema.workload
    .filter((w) => !removed.has(w.clientId))
    .map((w) => ({ ...w, mix: w.mix.filter((m) => !removedEps.has(m.endpointId)) }));
  const faults = schema.faults.filter((f) => !faultTouches(f.action, removed, removedEdges, removedEps));
  return { ...schema, nodes, edges, endpoints, workload, faults };
}

/* ---------- Связи ---------- */

export function connect(
  schema: Schema,
  source: string,
  target: string,
): { schema: Schema; edgeId: string } | { error: ConnectError } {
  const err = connectError(schema, source, target);
  if (err) return { error: err };
  const edge: SchemaEdge = {
    id: newId(ID_PREFIX.edge),
    source,
    target,
    kind: 'call',
    network: { latencyMs: 1, lossPct: 0 },
  };
  return { schema: { ...schema, edges: [...schema.edges, edge] }, edgeId: edge.id };
}

export function updateEdge(schema: Schema, id: string, patch: Partial<Pick<SchemaEdge, 'network'>>): Schema {
  return { ...schema, edges: schema.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) };
}

/** Удаление связей; служебные связи шардов и реплик удаляются только вместе с узлами. */
export function removeEdges(schema: Schema, ids: string[]): Schema {
  const set = new Set(ids);
  const edges = schema.edges.filter((e) => !set.has(e.id) || e.kind !== 'call');
  const faults = schema.faults.filter((f) => !('edgeId' in f.action && set.has(f.action.edgeId)));
  return { ...schema, edges, faults };
}

/* ---------- Копирование и вставка ---------- */

export interface Fragment {
  nodes: SchemaNode[];
  edges: SchemaEdge[];
  endpoints: Endpoint[];
  workload: ClientWorkload[];
}

export function extractFragment(schema: Schema, ids: string[]): Fragment {
  const set = new Set(ids);
  for (const n of schema.nodes) if (n.groupId && set.has(n.groupId)) set.add(n.id);
  return {
    nodes: schema.nodes.filter((n) => set.has(n.id)),
    edges: schema.edges.filter((e) => set.has(e.source) && set.has(e.target)),
    endpoints: schema.endpoints.filter((e) => set.has(e.serviceId)),
    workload: schema.workload.filter((w) => set.has(w.clientId)),
  };
}

/** Вставка фрагмента с новыми id и смещением; ссылки внутри фрагмента переназначаются. */
export function pasteFragment(
  schema: Schema,
  fragment: Fragment,
  offset: { x: number; y: number },
  rename: (name: string) => string,
): { schema: Schema; ids: string[] } {
  const map = new Map<string, string>();
  for (const n of fragment.nodes) map.set(n.id, newId(ID_PREFIX[n.kind]));
  for (const e of fragment.endpoints) map.set(e.id, newId(ID_PREFIX.endpoint));
  const re = (id: string | null | undefined) => (id ? (map.get(id) ?? id) : (id ?? null));

  const nodes = fragment.nodes.map((n) => ({
    ...n,
    id: map.get(n.id)!,
    name: n.role ? n.name : rename(n.name),
    groupId: n.groupId ? re(n.groupId)! : undefined,
    position: { x: n.position.x + offset.x, y: n.position.y + offset.y },
  }));
  const edges = fragment.edges.map((e) => ({
    ...e,
    id: newId(ID_PREFIX.edge),
    source: map.get(e.source)!,
    target: map.get(e.target)!,
  }));
  const endpoints = fragment.endpoints.map((ep) => {
    const stepMap = new Map(ep.steps.map((s) => [s.id, newId(ID_PREFIX.step)]));
    return {
      ...ep,
      id: map.get(ep.id)!,
      serviceId: map.get(ep.serviceId)!,
      steps: ep.steps.map((s) => ({
        ...s,
        id: stepMap.get(s.id)!,
        targetId: re(s.targetId),
        targetEndpointId: re(s.targetEndpointId),
      })),
      transaction: ep.transaction
        ? {
            ...ep.transaction,
            fromStepId: stepMap.get(ep.transaction.fromStepId) ?? ep.transaction.fromStepId,
            toStepId: stepMap.get(ep.transaction.toStepId) ?? ep.transaction.toStepId,
            coordinatorId: re(ep.transaction.coordinatorId),
          }
        : null,
    };
  });
  const workload = fragment.workload.map((w) => ({
    ...w,
    clientId: map.get(w.clientId)!,
    mix: w.mix.map((m) => ({ ...m, endpointId: re(m.endpointId)! })),
  }));
  return {
    schema: {
      ...schema,
      nodes: [...schema.nodes, ...nodes],
      edges: [...schema.edges, ...edges],
      endpoints: [...schema.endpoints, ...endpoints],
      workload: [...schema.workload, ...workload],
    },
    ids: nodes.filter((n) => !n.role).map((n) => n.id),
  };
}

/* ---------- Эндпоинты и шаги (5.5) ---------- */

export function addEndpoint(schema: Schema, serviceId: string, name: string, trigger: Trigger): Schema {
  const ep: Endpoint = { id: newId(ID_PREFIX.endpoint), serviceId, name, trigger, steps: [], transaction: null };
  return { ...schema, endpoints: [...schema.endpoints, ep] };
}

export function updateEndpoint(schema: Schema, id: string, patch: Partial<Omit<Endpoint, 'id' | 'serviceId'>>): Schema {
  return { ...schema, endpoints: schema.endpoints.map((e) => (e.id === id ? { ...e, ...patch } : e)) };
}

export function removeEndpoint(schema: Schema, id: string): Schema {
  return {
    ...schema,
    endpoints: schema.endpoints
      .filter((e) => e.id !== id)
      .map((ep) => ({
        ...ep,
        steps: ep.steps.map((s) => (s.targetEndpointId === id ? { ...s, targetEndpointId: null } : s)),
      })),
    workload: schema.workload.map((w) => ({ ...w, mix: w.mix.filter((m) => m.endpointId !== id) })),
    faults: schema.faults.filter((f) => !(f.action.type === 'coordinatorCrash' && f.action.endpointId === id)),
  };
}

export function createStep(type: StepType): Step {
  return {
    id: newId(ID_PREFIX.step),
    type,
    targetId: null,
    targetEndpointId: type === 'call' ? null : undefined,
    topic: type === 'publish' ? '' : undefined,
    action: type === 'dbRead' || type === 'dbWrite' || type === 'cacheRead' || type === 'cacheWrite' ? null : undefined,
    durationMs: type === 'compute' ? 5 : 0,
  };
}

function mapEndpoint(schema: Schema, id: string, fn: (ep: Endpoint) => Endpoint): Schema {
  return { ...schema, endpoints: schema.endpoints.map((e) => (e.id === id ? fn(e) : e)) };
}

export function addStep(schema: Schema, endpointId: string, step: Step): Schema {
  return mapEndpoint(schema, endpointId, (ep) => ({ ...ep, steps: [...ep.steps, step] }));
}

export function updateStep(schema: Schema, endpointId: string, stepId: string, patch: Partial<Omit<Step, 'id'>>): Schema {
  return mapEndpoint(schema, endpointId, (ep) => ({
    ...ep,
    steps: ep.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
  }));
}

export function removeStep(schema: Schema, endpointId: string, stepId: string): Schema {
  return mapEndpoint(schema, endpointId, (ep) => {
    const idx = ep.steps.findIndex((s) => s.id === stepId);
    const steps = ep.steps.filter((s) => s.id !== stepId);
    let transaction = ep.transaction;
    if (transaction && (transaction.fromStepId === stepId || transaction.toStepId === stepId)) {
      if (steps.length === 0) transaction = null;
      else {
        const neighbour = steps[Math.min(idx, steps.length - 1)].id;
        transaction = {
          ...transaction,
          fromStepId: transaction.fromStepId === stepId ? neighbour : transaction.fromStepId,
          toStepId: transaction.toStepId === stepId ? neighbour : transaction.toStepId,
        };
      }
    }
    return { ...ep, steps, transaction };
  });
}

/** Перестановка шага (перетаскивание в списке). */
export function moveStep(schema: Schema, endpointId: string, from: number, to: number): Schema {
  return mapEndpoint(schema, endpointId, (ep) => {
    const steps = [...ep.steps];
    const [s] = steps.splice(from, 1);
    if (!s) return ep;
    steps.splice(Math.max(0, Math.min(to, steps.length)), 0, s);
    return { ...ep, steps };
  });
}

export function defaultTransaction(ep: Endpoint, pattern: TxPattern = 'local'): Transaction | null {
  if (ep.steps.length === 0) return null;
  return {
    fromStepId: ep.steps[0].id,
    toStepId: ep.steps[ep.steps.length - 1].id,
    pattern,
    coordinatorId: pattern === '2pc' || pattern === 'sagaOrchestration' ? ep.serviceId : null,
    options: { outbox: false, idempotentConsumers: false, phaseTimeoutMs: 500, retries: 2 },
  };
}

export function setTransaction(schema: Schema, endpointId: string, tx: Transaction | null): Schema {
  return mapEndpoint(schema, endpointId, (ep) => ({ ...ep, transaction: tx }));
}

/** Смена паттерна; для 2PC и оркестрации подставляется координатор по умолчанию (сам сервис). */
export function setPattern(schema: Schema, endpointId: string, pattern: TxPattern): Schema {
  return mapEndpoint(schema, endpointId, (ep) => {
    const tx = ep.transaction ?? defaultTransaction(ep, pattern);
    if (!tx) return ep;
    const needsCoord = pattern === '2pc' || pattern === 'sagaOrchestration';
    return {
      ...ep,
      transaction: { ...tx, pattern, coordinatorId: needsCoord ? (tx.coordinatorId ?? ep.serviceId) : null },
    };
  });
}

/** Автоматически сгенерированные компенсации для шагов транзакции (5.6). */
export function compensationsFor(ep: Endpoint): { stepId: string; actionId: string }[] {
  const out: { stepId: string; actionId: string }[] = [];
  for (const s of ep.steps) {
    const c = compensationOf(s.action);
    if (c) out.push({ stepId: s.id, actionId: c.id });
  }
  return out;
}

/* ---------- Нагрузка (5.7) ---------- */

export function updateWorkload(schema: Schema, clientId: string, patch: Partial<Omit<ClientWorkload, 'clientId'>>): Schema {
  const exists = schema.workload.some((w) => w.clientId === clientId);
  const base: ClientWorkload = { clientId, profile: 'constant', rps: 100, mix: [] };
  return {
    ...schema,
    workload: exists
      ? schema.workload.map((w) => (w.clientId === clientId ? { ...w, ...patch } : w))
      : [...schema.workload, { ...base, ...patch }],
  };
}

/** Равномерно раскидать проценты смеси, чтобы сумма была ровно 100. */
export function evenMix(endpointIds: string[]): { endpointId: string; pct: number }[] {
  if (endpointIds.length === 0) return [];
  const base = Math.floor(100 / endpointIds.length);
  return endpointIds.map((endpointId, i) => ({
    endpointId,
    pct: i === 0 ? 100 - base * (endpointIds.length - 1) : base,
  }));
}
