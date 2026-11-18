/**
 * Проверка схемы (ТЗ 5.1, последний пункт): ошибки подсвечиваются на узлах, схему с ошибками
 * запустить нельзя. Формат результата совпадает с ответом `POST /api/validate` (6.2), поэтому
 * когда появится движок, его ответ можно просто объединить с локальной проверкой.
 * Тексты — в i18n по ключу `issues.<code>`.
 */
import {
  clientPath,
  isConnected,
  nodeById,
  STEP_TARGET_KIND,
  subscribersOf,
  txNeedsDistributedPattern,
  txSteps,
} from './analysis';
import { connectError } from './rules';
import type { Schema } from './types';

export type IssueCode =
  | 'noClients'
  | 'serviceNoEndpoints'
  | 'stepNoTarget'
  | 'stepTargetNotConnected'
  | 'stepTargetWrongKind'
  | 'callNoEndpoint'
  | 'publishNoTopic'
  | 'dataStepNoAction'
  | 'clientNoTarget'
  | 'clientNoMix'
  | 'clientMixSum'
  | 'clientMixUnreachable'
  | 'topicNoSubscribers'
  | 'handlerNoPublisher'
  | 'txNeedsCoordinator'
  | 'sagaNoBroker'
  | 'txCrossShard'
  | 'txMultiDb'
  | 'invalidEdge'
  | 'emptyEndpoint';

export interface Issue {
  severity: 'error' | 'warning';
  code: IssueCode;
  nodeId?: string;
  edgeId?: string;
  endpointId?: string;
  stepId?: string;
  params?: Record<string, string | number>;
}

export function validateSchema(schema: Schema): Issue[] {
  const issues: Issue[] = [];
  const err = (i: Omit<Issue, 'severity'>) => issues.push({ severity: 'error', ...i });
  const warn = (i: Omit<Issue, 'severity'>) => issues.push({ severity: 'warning', ...i });

  const clients = schema.nodes.filter((n) => n.kind === 'client');
  if (clients.length === 0) err({ code: 'noClients' });

  // Связи, нарушающие правила (например, после импорта чужого JSON).
  for (const e of schema.edges) {
    if (e.kind !== 'call') continue;
    const others = { ...schema, edges: schema.edges.filter((x) => x.id !== e.id) };
    if (connectError(others, e.source, e.target)) err({ code: 'invalidEdge', edgeId: e.id, nodeId: e.source });
  }

  for (const n of schema.nodes) {
    if (n.kind === 'service' && !schema.endpoints.some((ep) => ep.serviceId === n.id))
      err({ code: 'serviceNoEndpoints', nodeId: n.id, params: { name: n.name } });
  }

  for (const ep of schema.endpoints) {
    const at = { nodeId: ep.serviceId, endpointId: ep.id };
    if (ep.steps.length === 0) warn({ code: 'emptyEndpoint', ...at, params: { name: ep.name } });
    ep.steps.forEach((s, i) => {
      const st = { ...at, stepId: s.id, params: { name: ep.name, step: i + 1 } };
      const kind = STEP_TARGET_KIND[s.type];
      if (kind) {
        const target = nodeById(schema, s.targetId);
        if (!target) err({ code: 'stepNoTarget', ...st });
        else if (target.kind !== kind) err({ code: 'stepTargetWrongKind', ...st });
        else if (!isConnected(schema, ep.serviceId, target.id)) err({ code: 'stepTargetNotConnected', ...st });
      }
      if (s.type === 'call' && s.targetId) {
        const callee = schema.endpoints.find((x) => x.id === s.targetEndpointId);
        if (!callee || callee.serviceId !== s.targetId) err({ code: 'callNoEndpoint', ...st });
      }
      if (s.type === 'publish') {
        if (!s.topic) err({ code: 'publishNoTopic', ...st });
        else if (subscribersOf(schema, s.topic).length === 0)
          warn({ code: 'topicNoSubscribers', ...st, params: { ...st.params, topic: s.topic } });
      }
      if ((s.type === 'dbWrite' || s.type === 'dbRead') && !s.action) warn({ code: 'dataStepNoAction', ...st });
    });

    if (ep.trigger.type === 'message') {
      const topic = ep.trigger.topic;
      const published = schema.endpoints.some((x) => x.steps.some((s) => s.type === 'publish' && s.topic === topic));
      if (!published) warn({ code: 'handlerNoPublisher', ...at, params: { name: ep.name, topic } });
    }

    const tx = ep.transaction;
    if (tx) {
      if ((tx.pattern === '2pc' || tx.pattern === 'sagaOrchestration') && !nodeById(schema, tx.coordinatorId))
        err({ code: 'txNeedsCoordinator', ...at, params: { name: ep.name } });
      if (tx.pattern === 'sagaChoreography' && !txSteps(ep).some((s) => s.type === 'publish' && s.targetId))
        err({ code: 'sagaNoBroker', ...at, params: { name: ep.name } });
      const spread = txNeedsDistributedPattern(schema, ep);
      if (spread === 'crossShard') warn({ code: 'txCrossShard', ...at, params: { name: ep.name } });
      if (spread === 'multiDb') warn({ code: 'txMultiDb', ...at, params: { name: ep.name } });
    }
  }

  for (const c of clients) {
    const w = schema.workload.find((x) => x.clientId === c.id);
    if (!schema.edges.some((e) => e.source === c.id)) {
      err({ code: 'clientNoTarget', nodeId: c.id, params: { name: c.name } });
      continue;
    }
    if (!w || w.mix.length === 0) {
      err({ code: 'clientNoMix', nodeId: c.id, params: { name: c.name } });
      continue;
    }
    const sum = w.mix.reduce((a, m) => a + m.pct, 0);
    if (Math.abs(sum - 100) > 0.01) err({ code: 'clientMixSum', nodeId: c.id, params: { name: c.name, sum } });
    for (const m of w.mix) {
      const ep = schema.endpoints.find((e) => e.id === m.endpointId);
      if (!ep || !clientPath(schema, c.id, ep.serviceId))
        err({ code: 'clientMixUnreachable', nodeId: c.id, params: { name: c.name, endpoint: ep?.name ?? '?' } });
    }
  }

  return issues;
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

/** Проблемы, относящиеся к узлу, — для значков на холсте. */
export function issuesByNode(issues: Issue[]): Map<string, Issue[]> {
  const map = new Map<string, Issue[]>();
  for (const i of issues) {
    if (!i.nodeId) continue;
    const list = map.get(i.nodeId) ?? [];
    list.push(i);
    map.set(i.nodeId, list);
  }
  return map;
}
