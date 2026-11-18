/** Запросы к схеме без побочных эффектов: соседи, участники транзакций, кросс-шардовость. */
import { getAction } from './dictionary';
import { PASS_THROUGH_KINDS } from './rules';
import type { Endpoint, NodeKind, Schema, SchemaNode, Step, StepType } from './types';

export function nodeById(schema: Schema, id: string | null | undefined): SchemaNode | undefined {
  return id ? schema.nodes.find((n) => n.id === id) : undefined;
}

export function outgoing(schema: Schema, nodeId: string): SchemaNode[] {
  const ids = new Set(schema.edges.filter((e) => e.source === nodeId && e.kind === 'call').map((e) => e.target));
  return schema.nodes.filter((n) => ids.has(n.id));
}

export function isConnected(schema: Schema, sourceId: string, targetId: string): boolean {
  return schema.edges.some((e) => e.source === sourceId && e.target === targetId);
}

export const STEP_TARGET_KIND: Record<StepType, NodeKind | null> = {
  dbRead: 'database',
  dbWrite: 'database',
  call: 'service',
  publish: 'broker',
  cacheRead: 'cache',
  cacheWrite: 'cache',
  compute: null,
};

/** Узлы, которые можно выбрать целью шага: связаны с сервисом и подходят по типу (5.5). */
export function stepTargetOptions(schema: Schema, serviceId: string, type: StepType): SchemaNode[] {
  const kind = STEP_TARGET_KIND[type];
  if (!kind) return [];
  return outgoing(schema, serviceId).filter((n) => n.kind === kind && !n.role);
}

export function endpointsOf(schema: Schema, serviceId: string): Endpoint[] {
  return schema.endpoints.filter((e) => e.serviceId === serviceId);
}

export function httpEndpointsOf(schema: Schema, serviceId: string): Endpoint[] {
  return endpointsOf(schema, serviceId).filter((e) => e.trigger.type === 'http');
}

export function subscribersOf(schema: Schema, topic: string): Endpoint[] {
  return schema.endpoints.filter((e) => e.trigger.type === 'message' && e.trigger.topic === topic);
}

/** Все известные топики: из шагов публикации и подписок. */
export function allTopics(schema: Schema): string[] {
  const set = new Set<string>();
  for (const ep of schema.endpoints) {
    if (ep.trigger.type === 'message' && ep.trigger.topic) set.add(ep.trigger.topic);
    for (const s of ep.steps) if (s.type === 'publish' && s.topic) set.add(s.topic);
  }
  return [...set].sort();
}

/** Брокер, через который идёт топик (по шагам публикации). */
export function brokerOfTopic(schema: Schema, topic: string): string | null {
  for (const ep of schema.endpoints)
    for (const s of ep.steps) if (s.type === 'publish' && s.topic === topic && s.targetId) return s.targetId;
  return null;
}

/** Шаги, входящие в диапазон транзакции эндпоинта. */
export function txSteps(ep: Endpoint): Step[] {
  const tx = ep.transaction;
  if (!tx) return [];
  const a = ep.steps.findIndex((s) => s.id === tx.fromStepId);
  const b = ep.steps.findIndex((s) => s.id === tx.toStepId);
  if (a < 0 || b < 0) return [];
  return ep.steps.slice(Math.min(a, b), Math.max(a, b) + 1);
}

export function stepInTx(ep: Endpoint, stepId: string): boolean {
  return txSteps(ep).some((s) => s.id === stepId);
}

/**
 * Узлы-участники транзакции: цели шагов, вызванные сервисы и их хранилища,
 * подписчики опубликованных событий (для хореографии), координатор (5.6).
 */
export function txParticipants(schema: Schema, ep: Endpoint): { participants: string[]; coordinator: string | null } {
  const set = new Set<string>([ep.serviceId]);
  const visit = (steps: Step[], depth: number) => {
    for (const s of steps) {
      if (s.targetId) set.add(s.targetId);
      if (depth > 2) continue;
      if (s.type === 'call' && s.targetEndpointId) {
        const callee = schema.endpoints.find((e) => e.id === s.targetEndpointId);
        if (callee) visit(callee.steps, depth + 1);
      }
      if (s.type === 'publish' && s.topic) {
        for (const sub of subscribersOf(schema, s.topic)) {
          set.add(sub.serviceId);
          visit(sub.steps, depth + 1);
        }
      }
    }
  };
  visit(txSteps(ep), 0);
  const coordinator = ep.transaction?.coordinatorId ?? null;
  if (coordinator) set.delete(coordinator);
  return { participants: [...set], coordinator };
}

/** Записи в БД внутри транзакции (включая вызванные синхронно сервисы). */
function txWrites(schema: Schema, ep: Endpoint): Step[] {
  const out: Step[] = [];
  const visit = (steps: Step[], depth: number) => {
    for (const s of steps) {
      if (s.type === 'dbWrite' && s.targetId) out.push(s);
      if (s.type === 'call' && s.targetEndpointId && depth < 3) {
        const callee = schema.endpoints.find((e) => e.id === s.targetEndpointId);
        if (callee) visit(callee.steps, depth + 1);
      }
    }
  };
  visit(txSteps(ep), 0);
  return out;
}

export type TxSpread = 'single' | 'crossShard' | 'multiDb';

/**
 * Насколько «распределена» транзакция:
 * - multiDb — пишет в несколько разных БД;
 * - crossShard — несколько записей в шардированную БД (ключи разных строк попадают в разные шарды);
 * - single — всё в одной нешардированной БД.
 */
export function txSpread(schema: Schema, ep: Endpoint): TxSpread {
  const writes = txWrites(schema, ep);
  const dbs = new Set(writes.map((w) => w.targetId));
  if (dbs.size > 1) return 'multiDb';
  if (writes.length >= 2) {
    const db = nodeById(schema, writes[0].targetId);
    if (db?.scaling?.sharding) return 'crossShard';
  }
  return 'single';
}

/** Транзакция с паттерном «без транзакции»/«локальная» охватывает несколько шардов или БД (сценарий 2). */
export function txNeedsDistributedPattern(schema: Schema, ep: Endpoint): TxSpread | null {
  if (!ep.transaction) return null;
  if (ep.transaction.pattern !== 'none' && ep.transaction.pattern !== 'local') return null;
  const spread = txSpread(schema, ep);
  return spread === 'single' ? null : spread;
}

/** Эндпоинты, транзакции которых пишут в данную БД — нужны для предупреждения после шардирования. */
export function endpointsWritingTo(schema: Schema, dbId: string): Endpoint[] {
  return schema.endpoints.filter((ep) => txWrites(schema, ep).some((s) => s.targetId === dbId));
}

/** Может ли клиент дотянуться до сервиса через шлюзы и балансировщики. */
export function reachableFromClient(schema: Schema, clientId: string, serviceId: string): boolean {
  return clientPath(schema, clientId, serviceId) !== null;
}

/** Путь клиент → … → сервис через транзитные узлы (BFS), список id узлов включая концы. */
export function clientPath(schema: Schema, clientId: string, serviceId: string): string[] | null {
  const prev = new Map<string, string>();
  const queue = [clientId];
  const seen = new Set(queue);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of schema.edges) {
      if (e.source !== cur || e.kind !== 'call' || seen.has(e.target)) continue;
      const n = nodeById(schema, e.target);
      if (!n) continue;
      prev.set(n.id, cur);
      if (n.id === serviceId) {
        const path = [n.id];
        let p = cur;
        while (p !== clientId) {
          path.push(p);
          p = prev.get(p)!;
        }
        path.push(clientId);
        return path.reverse();
      }
      if (PASS_THROUGH_KINDS.includes(n.kind)) {
        seen.add(n.id);
        queue.push(n.id);
      }
    }
  }
  return null;
}

export function edgeBetween(schema: Schema, a: string, b: string) {
  return schema.edges.find((e) => e.source === a && e.target === b);
}

/** Есть ли в цепочке шагов запись по действию из словаря с компенсацией. */
export function hasCompensation(step: Step): boolean {
  return !!getAction(step.action)?.compensation;
}

/** Шарды и реплики, принадлежащие узлу. */
export function derivedNodes(schema: Schema, nodeId: string, role?: 'shard' | 'replica'): SchemaNode[] {
  return schema.nodes.filter((n) => n.groupId === nodeId && (!role || n.role === role));
}
