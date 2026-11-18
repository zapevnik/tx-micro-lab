/**
 * Масштабирование БД (ТЗ 5.4) — чистые преобразования схемы.
 *
 * Шардирование: исходный узел БД становится маршрутизатором (сохраняет id, поэтому связи и шаги
 * эндпоинтов, указывающие на БД, остаются валидными), под ним создаются N узлов-шардов.
 * Репликация: рядом с лидером появляются узлы-реплики, связанные пунктиром.
 * Партиционирование: узел остаётся один, в нём только появляется описание сегментов.
 * Каждая операция обратима (отдельная функция «убрать» + общая отмена через историю).
 */
import { derivedNodes, nodeById } from '@/schema/analysis';
import { ID_PREFIX, newId } from '@/schema/ids';
import type {
  PartitioningConfig,
  ReplicationConfig,
  Schema,
  SchemaEdge,
  SchemaNode,
  ShardingConfig,
} from '@/schema/types';

const NODE_W = 200;
const NODE_H = 110;
const GAP_X = 30;
const GAP_Y = 20;

type Pos = { x: number; y: number };

/** Варианты раскладки группы из n узлов вокруг исходного: ряд снизу/сверху, колонка справа/слева. */
function layouts(origin: Pos, n: number, w: number): Record<'below' | 'above' | 'right' | 'left', Pos[]> {
  const rowW = n * w + (n - 1) * GAP_X;
  const colH = n * NODE_H + (n - 1) * GAP_Y;
  const row = (y: number) => Array.from({ length: n }, (_, i) => ({ x: origin.x + NODE_W / 2 - rowW / 2 + i * (w + GAP_X), y }));
  const col = (x: number) => Array.from({ length: n }, (_, i) => ({ x, y: origin.y + 30 - colH / 2 + i * (NODE_H + GAP_Y) }));
  return {
    below: row(origin.y + 170),
    above: row(origin.y - 190),
    right: col(origin.x + NODE_W + 70),
    left: col(origin.x - w - 70),
  };
}

/** Выбрать раскладку, которая меньше всего перекрывает уже стоящие узлы. */
function placeGroup(schema: Schema, origin: Pos, n: number, prefer: ('below' | 'above' | 'right' | 'left')[]): Pos[] {
  const w = 170;
  const all = layouts(origin, n, w);
  const overlaps = (p: Pos) =>
    schema.nodes.filter(
      (o) =>
        p.x < o.position.x + NODE_W + 15 && p.x + w + 15 > o.position.x && p.y < o.position.y + NODE_H && p.y + NODE_H > o.position.y,
    ).length;
  let best = all[prefer[0]];
  let bestScore = Infinity;
  for (const k of prefer) {
    const score = all[k].reduce((a, p) => a + overlaps(p), 0);
    if (score < bestScore) {
      best = all[k];
      bestScore = score;
    }
  }
  return best;
}

function withoutDerived(schema: Schema, dbId: string, role: 'shard' | 'replica'): Schema {
  const ids = new Set(derivedNodes(schema, dbId, role).map((n) => n.id));
  // Вместе с шардами уходят и их реплики.
  for (const n of schema.nodes) if (n.groupId && ids.has(n.groupId)) ids.add(n.id);
  return {
    ...schema,
    nodes: schema.nodes.filter((n) => !ids.has(n.id)),
    edges: schema.edges.filter((e) => !ids.has(e.source) && !ids.has(e.target)),
    faults: schema.faults.filter((f) => !('nodeId' in f.action && ids.has(f.action.nodeId))),
  };
}

function setScaling(schema: Schema, dbId: string, patch: NonNullable<SchemaNode['scaling']>): Schema {
  return {
    ...schema,
    nodes: schema.nodes.map((n) => {
      if (n.id !== dbId) return n;
      const scaling = { ...n.scaling, ...patch };
      for (const k of Object.keys(scaling) as (keyof typeof scaling)[]) if (!scaling[k]) delete scaling[k];
      return { ...n, scaling: Object.keys(scaling).length ? scaling : undefined };
    }),
  };
}

function internalEdge(source: string, target: string, kind: 'shard' | 'replication'): SchemaEdge {
  return { id: newId(ID_PREFIX.edge), source, target, kind, network: { latencyMs: 0.5, lossPct: 0 } };
}

export function canScale(node: SchemaNode | undefined): boolean {
  return !!node && node.kind === 'database' && node.role !== 'replica';
}

export function shardDatabase(schema: Schema, dbId: string, config: ShardingConfig): Schema {
  const db = nodeById(schema, dbId);
  if (!db || db.kind !== 'database' || db.role) return schema;
  let next = withoutDerived(schema, dbId, 'shard');
  next = setScaling(next, dbId, { sharding: config });
  const spots = placeGroup(next, db.position, config.count, ['below', 'above', 'right', 'left']);
  const shards: SchemaNode[] = [];
  const edges: SchemaEdge[] = [];
  for (let i = 0; i < config.count; i++) {
    const shard: SchemaNode = {
      id: newId(ID_PREFIX.database),
      kind: 'database',
      name: `${db.name} #${i + 1}`,
      position: spots[i],
      params: { ...db.params },
      groupId: dbId,
      role: 'shard',
      index: i,
    };
    shards.push(shard);
    edges.push(internalEdge(dbId, shard.id, 'shard'));
  }
  return { ...next, nodes: [...next.nodes, ...shards], edges: [...next.edges, ...edges] };
}

export function unshardDatabase(schema: Schema, dbId: string): Schema {
  return setScaling(withoutDerived(schema, dbId, 'shard'), dbId, { sharding: undefined });
}

export function replicateDatabase(schema: Schema, dbId: string, config: ReplicationConfig): Schema {
  const db = nodeById(schema, dbId);
  if (!db || db.kind !== 'database' || db.role === 'replica') return schema;
  let next = withoutDerived(schema, dbId, 'replica');
  next = setScaling(next, dbId, { replication: config });
  const spots = placeGroup(next, db.position, config.count, ['right', 'below', 'above', 'left']);
  const replicas: SchemaNode[] = [];
  const edges: SchemaEdge[] = [];
  for (let i = 0; i < config.count; i++) {
    const r: SchemaNode = {
      id: newId(ID_PREFIX.database),
      kind: 'database',
      name: `${db.name} R${i + 1}`,
      position: spots[i],
      params: { ...db.params },
      groupId: dbId,
      role: 'replica',
      index: i,
    };
    replicas.push(r);
    edges.push(internalEdge(dbId, r.id, 'replication'));
  }
  return { ...next, nodes: [...next.nodes, ...replicas], edges: [...next.edges, ...edges] };
}

export function unreplicateDatabase(schema: Schema, dbId: string): Schema {
  return setScaling(withoutDerived(schema, dbId, 'replica'), dbId, { replication: undefined });
}

export function partitionDatabase(schema: Schema, dbId: string, config: PartitioningConfig): Schema {
  const db = nodeById(schema, dbId);
  if (!db || db.kind !== 'database') return schema;
  return setScaling(schema, dbId, { partitioning: config });
}

export function unpartitionDatabase(schema: Schema, dbId: string): Schema {
  return setScaling(schema, dbId, { partitioning: undefined });
}

export const DEFAULT_SHARDING: ShardingConfig = { count: 4, key: 'id', strategy: 'hash' };
export const DEFAULT_REPLICATION: ReplicationConfig = { count: 2, mode: 'async', lagMs: 50, readPolicy: 'replicas' };
export const DEFAULT_PARTITIONING: PartitioningConfig = { table: 'orders', key: 'created_at', count: 8 };
