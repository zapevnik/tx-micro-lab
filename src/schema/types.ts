/**
 * Формат схемы проекта (ТЗ, раздел 6.1).
 *
 * Это единственный источник правды о структуре схемы: TypeScript-типы выводятся из Zod-схем,
 * а для Go-движка из них же можно сгенерировать JSON Schema (zod-to-json-schema), чтобы
 * фронтенд и движок не расходились. Любое изменение формата — повышение SCHEMA_VERSION
 * и миграция в `migrate.ts`.
 */
import { z } from 'zod';

export const SCHEMA_VERSION = 1;

/* ---------- Узлы ---------- */

export const NODE_KINDS = ['client', 'gateway', 'balancer', 'service', 'database', 'cache', 'broker'] as const;
export const NodeKind = z.enum(NODE_KINDS);
export type NodeKind = z.infer<typeof NodeKind>;

export const ParamValue = z.union([z.number(), z.string(), z.boolean()]);
export type ParamValue = z.infer<typeof ParamValue>;

export const Position = z.object({ x: z.number(), y: z.number() });

export const ShardingConfig = z.object({
  count: z.number().int().min(2).max(8),
  key: z.string().min(1),
  strategy: z.enum(['hash', 'range']),
});
export type ShardingConfig = z.infer<typeof ShardingConfig>;

export const ReplicationConfig = z.object({
  count: z.number().int().min(1).max(5),
  mode: z.enum(['sync', 'async']),
  lagMs: z.number().min(0),
  readPolicy: z.enum(['leader', 'replicas']),
});
export type ReplicationConfig = z.infer<typeof ReplicationConfig>;

export const PartitioningConfig = z.object({
  table: z.string().min(1),
  key: z.string().min(1),
  count: z.number().int().min(2).max(64),
});
export type PartitioningConfig = z.infer<typeof PartitioningConfig>;

export const NodeRole = z.enum(['shard', 'replica']);
export type NodeRole = z.infer<typeof NodeRole>;

export const SchemaNode = z.object({
  id: z.string().min(1),
  kind: NodeKind,
  name: z.string(),
  position: Position,
  params: z.record(z.string(), ParamValue),
  /** Ссылка на родительскую группу: для шарда — маршрутизатор (исходная БД), для реплики — лидер. */
  groupId: z.string().optional(),
  role: NodeRole.optional(),
  /** Номер шарда или реплики внутри группы. */
  index: z.number().int().optional(),
  scaling: z
    .object({
      sharding: ShardingConfig.optional(),
      replication: ReplicationConfig.optional(),
      partitioning: PartitioningConfig.optional(),
    })
    .optional(),
});
export type SchemaNode = z.infer<typeof SchemaNode>;

/* ---------- Связи ---------- */

export const EdgeKind = z.enum(['call', 'shard', 'replication']);
export type EdgeKind = z.infer<typeof EdgeKind>;

export const SchemaEdge = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  kind: EdgeKind,
  network: z.object({
    latencyMs: z.number().min(0),
    lossPct: z.number().min(0).max(100),
  }),
});
export type SchemaEdge = z.infer<typeof SchemaEdge>;

/* ---------- Эндпоинты, шаги, транзакции ---------- */

export const STEP_TYPES = ['dbRead', 'dbWrite', 'call', 'publish', 'cacheRead', 'cacheWrite', 'compute'] as const;
export const StepType = z.enum(STEP_TYPES);
export type StepType = z.infer<typeof StepType>;

export const Step = z.object({
  id: z.string().min(1),
  type: StepType,
  /** Целевой узел: БД, кэш, сервис или брокер. Для compute — null. */
  targetId: z.string().nullable(),
  /** Для call — вызываемый эндпоинт целевого сервиса. */
  targetEndpointId: z.string().nullable().optional(),
  /** Для publish — топик. */
  topic: z.string().optional(),
  /** Действие над данными из словаря (dictionary.ts) — нужно движку для проверки инвариантов. */
  action: z.string().nullable().optional(),
  /** Собственное время шага (для compute — время CPU), мс. */
  durationMs: z.number().min(0),
  /** Длительность компенсирующего действия (саги, TCC), мс. */
  compensationDurationMs: z.number().min(0).optional(),
});
export type Step = z.infer<typeof Step>;

export const TX_PATTERNS = ['none', 'local', '2pc', 'sagaOrchestration', 'sagaChoreography', 'tcc'] as const;
export const TxPattern = z.enum(TX_PATTERNS);
export type TxPattern = z.infer<typeof TxPattern>;

export const Transaction = z.object({
  fromStepId: z.string(),
  toStepId: z.string(),
  pattern: TxPattern,
  coordinatorId: z.string().nullable(),
  options: z.object({
    outbox: z.boolean(),
    idempotentConsumers: z.boolean(),
    phaseTimeoutMs: z.number().min(0),
    retries: z.number().int().min(0).max(10),
  }),
});
export type Transaction = z.infer<typeof Transaction>;

export const HttpMethod = z.enum(['GET', 'POST', 'PUT', 'DELETE']);

export const Trigger = z.discriminatedUnion('type', [
  z.object({ type: z.literal('http'), method: HttpMethod }),
  z.object({ type: z.literal('message'), topic: z.string() }),
]);
export type Trigger = z.infer<typeof Trigger>;

export const Endpoint = z.object({
  id: z.string().min(1),
  serviceId: z.string().min(1),
  name: z.string(),
  trigger: Trigger,
  steps: z.array(Step),
  transaction: Transaction.nullable(),
});
export type Endpoint = z.infer<typeof Endpoint>;

/* ---------- Нагрузка ---------- */

export const LoadProfile = z.enum(['constant', 'ramp', 'spike', 'sine']);
export type LoadProfile = z.infer<typeof LoadProfile>;

export const ClientWorkload = z.object({
  clientId: z.string(),
  profile: LoadProfile,
  rps: z.number().min(0),
  mix: z.array(z.object({ endpointId: z.string(), pct: z.number().min(0).max(100) })),
});
export type ClientWorkload = z.infer<typeof ClientWorkload>;

/* ---------- Отказы ---------- */

export const FaultAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('nodeDown'), nodeId: z.string() }),
  z.object({ type: z.literal('nodeSlow'), nodeId: z.string(), factor: z.number().min(1) }),
  z.object({ type: z.literal('linkDelay'), edgeId: z.string(), delayMs: z.number().min(0) }),
  z.object({ type: z.literal('linkLoss'), edgeId: z.string(), pct: z.number().min(0).max(100) }),
  z.object({ type: z.literal('linkDuplicate'), edgeId: z.string(), pct: z.number().min(0).max(100) }),
  z.object({ type: z.literal('linkPartition'), edgeId: z.string() }),
  /** Отказ в точке протокола: уронить координатор 2PC после prepare / оркестратор после шага N. */
  z.object({
    type: z.literal('coordinatorCrash'),
    endpointId: z.string(),
    after: z.enum(['prepare', 'step']),
    stepIndex: z.number().int().min(0).optional(),
  }),
]);
export type FaultAction = z.infer<typeof FaultAction>;
export type FaultType = FaultAction['type'];

export const ScheduledFault = z.object({
  id: z.string(),
  atS: z.number().min(0),
  /** 0 — до конца прогона. */
  durationS: z.number().min(0),
  action: FaultAction,
});
export type ScheduledFault = z.infer<typeof ScheduledFault>;

/* ---------- Инварианты ---------- */

export const INVARIANT_TYPES = ['moneyConserved', 'nonNegative', 'paidReserved', 'exactlyOnceDebit'] as const;
export const InvariantType = z.enum(INVARIANT_TYPES);
export type InvariantType = z.infer<typeof InvariantType>;

export const Invariant = z.object({
  id: z.string(),
  type: InvariantType,
  table: z.string(),
  field: z.string(),
});
export type Invariant = z.infer<typeof Invariant>;

/* ---------- Задание (режим заданий, 5.14) ---------- */

export const TaskGoals = z.object({
  minRps: z.number().min(0).optional(),
  maxP99Ms: z.number().min(0).optional(),
  maxViolations: z.number().int().min(0).optional(),
  holdS: z.number().min(1),
});
export type TaskGoals = z.infer<typeof TaskGoals>;

/* ---------- Схема целиком ---------- */

export const Schema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  meta: z.object({
    name: z.string(),
    description: z.string().optional(),
  }),
  nodes: z.array(SchemaNode),
  edges: z.array(SchemaEdge),
  endpoints: z.array(Endpoint),
  workload: z.array(ClientWorkload),
  faults: z.array(ScheduledFault),
  invariants: z.array(Invariant),
  seed: z.number().int(),
  task: TaskGoals.optional(),
});
export type Schema = z.infer<typeof Schema>;

export function emptySchema(name: string): Schema {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: { name },
    nodes: [],
    edges: [],
    endpoints: [],
    workload: [],
    faults: [],
    invariants: [],
    seed: 42,
  };
}
