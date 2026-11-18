/** Правила допустимых связей (ТЗ 5.2, колонка «Может связываться с»). */
import type { NodeKind, Schema } from './types';

export const ALLOWED_TARGETS: Record<NodeKind, readonly NodeKind[]> = {
  client: ['gateway', 'balancer', 'service'],
  gateway: ['balancer', 'service'],
  balancer: ['service'],
  service: ['service', 'database', 'cache', 'broker'],
  database: [],
  cache: [],
  broker: ['service'],
};

/** Узлы, через которые запрос клиента проходит транзитом к сервису. */
export const PASS_THROUGH_KINDS: readonly NodeKind[] = ['gateway', 'balancer'];

export type ConnectError =
  | 'selfLoop'
  | 'duplicate'
  | 'noIncoming'
  | 'notAllowed'
  | 'derivedNode'
  | 'unknownNode';

/** Причина, по которой связь создать нельзя, или null, если можно. */
export function connectError(schema: Schema, sourceId: string, targetId: string): ConnectError | null {
  if (sourceId === targetId) return 'selfLoop';
  const source = schema.nodes.find((n) => n.id === sourceId);
  const target = schema.nodes.find((n) => n.id === targetId);
  if (!source || !target) return 'unknownNode';
  if (source.role || target.role) return 'derivedNode';
  if (ALLOWED_TARGETS[source.kind].length === 0) return 'noIncoming';
  if (!ALLOWED_TARGETS[source.kind].includes(target.kind)) return 'notAllowed';
  if (schema.edges.some((e) => e.source === sourceId && e.target === targetId)) return 'duplicate';
  return null;
}
