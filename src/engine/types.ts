/**
 * Контракт фронтенда с движком моделирования (ТЗ, раздел 6).
 *
 * Здесь всё, что ходит между фронтендом и движком: команды WebSocket, сообщения движка,
 * тела REST-запросов и ответов. Сообщения описаны Zod-схемами: WebSocket-клиент проверяет
 * каждое входящее сообщение, а для Go-движка из этих схем генерируется JSON Schema.
 *
 * UI работает только с интерфейсом `EngineClient` и не знает, какая реализация активна
 * (mock или WebSocket) — см. `src/engine/index.ts`.
 *
 * Расширения относительно ТЗ (нужно внести в ТЗ движка):
 * - команда `clearFault` — снять отказ, наложенный `injectFault` («Включить» узел);
 * - `tick.recentTx` — короткий список последних транзакций для вкладки «Трассировка»;
 * - `tick.global` — агрегаты для глобальных графиков (5.12);
 * - `DELETE /api/experiments/{id}` — отмена пакетного прогона (5.13, п. 2).
 */
import { z } from 'zod';
import { FaultAction, Schema, ScheduledFault, TxPattern } from '@/schema/types';
import type { Issue } from '@/schema/validate';

/* ===================== Сообщения движка (WebSocket) ===================== */

export const NodeMetrics = z.object({
  rps: z.number(),
  /** Загрузка 0..1 (может быть > 1 при перегрузке). */
  load: z.number(),
  queue: z.number(),
  p50: z.number(),
  p99: z.number(),
  errorsPerS: z.number(),
  /** Удерживаемые блокировки (БД). */
  locks: z.number().optional(),
  /** Отставание реплики, мс. */
  lagMs: z.number().optional(),
  /** Непрочитанные сообщения (брокер). */
  backlog: z.number().optional(),
  down: z.boolean(),
});
export type NodeMetrics = z.infer<typeof NodeMetrics>;

export const EdgeMetrics = z.object({
  rps: z.number(),
  errorsPerS: z.number(),
  lagMs: z.number().optional(),
});
export type EdgeMetrics = z.infer<typeof EdgeMetrics>;

export const TxOutcome = z.enum(['committed', 'rolledBack', 'compensated', 'stuck', 'violated', 'failed']);
export type TxOutcome = z.infer<typeof TxOutcome>;

export const GlobalMetrics = z.object({
  throughput: z.number(),
  p50: z.number(),
  p95: z.number(),
  p99: z.number(),
  errorsPerS: z.number(),
  /** Исходы бизнес-транзакций за последнюю секунду, шт/с. */
  committed: z.number(),
  rolledBack: z.number(),
  compensated: z.number(),
  stuck: z.number(),
  failed: z.number(),
  /** Нарастающий итог нарушений инвариантов с начала запуска. */
  violationsTotal: z.number(),
  messagesPerTx: z.number(),
});
export type GlobalMetrics = z.infer<typeof GlobalMetrics>;

export const TxSummary = z.object({
  txId: z.string(),
  endpointId: z.string(),
  t: z.number(),
  durationMs: z.number(),
  outcome: TxOutcome,
});
export type TxSummary = z.infer<typeof TxSummary>;

export const TickMsg = z.object({
  type: z.literal('tick'),
  /** Виртуальное время, с. */
  t: z.number(),
  nodes: z.record(z.string(), NodeMetrics),
  edges: z.record(z.string(), EdgeMetrics),
  global: GlobalMetrics,
  recentTx: z.array(TxSummary).optional(),
});
export type TickMsg = z.infer<typeof TickMsg>;

export const FlowKind = z.enum(['request', 'response', 'message', 'compensation']);
export type FlowKind = z.infer<typeof FlowKind>;

export const FlowItem = z.object({
  edgeId: z.string(),
  dir: z.enum(['fwd', 'back']),
  kind: FlowKind,
  outcome: z.enum(['ok', 'error']),
  /** Время пролёта по связи в реальных мс (уже с учётом скорости). */
  durationMs: z.number(),
  /** Задержка старта относительно получения сообщения, мс. */
  delayMs: z.number(),
});
export type FlowItem = z.infer<typeof FlowItem>;

export const FlowsMsg = z.object({ type: z.literal('flows'), t: z.number(), items: z.array(FlowItem) });
export type FlowsMsg = z.infer<typeof FlowsMsg>;

export const AlertCode = z.enum([
  'dbOverload',
  'serviceOverload',
  'brokerBacklog',
  'replicaLag',
  'locksStuck',
  'coordinatorDown',
  'crossShardTx',
  'duplicateDelivery',
  'nodeDown',
]);
export type AlertCode = z.infer<typeof AlertCode>;

export const AlertMsg = z.object({
  type: z.literal('alert'),
  t: z.number(),
  code: AlertCode,
  nodeId: z.string(),
  /** true — проблема появилась, false — ушла. */
  active: z.boolean(),
  params: z.record(z.string(), z.union([z.string(), z.number()])),
});
export type AlertMsg = z.infer<typeof AlertMsg>;

export const ViolationMsg = z.object({
  type: z.literal('violation'),
  t: z.number(),
  invariantId: z.string(),
  txId: z.string(),
  nodeId: z.string().optional(),
});
export type ViolationMsg = z.infer<typeof ViolationMsg>;

export const SpanKind = z.enum(['work', 'queue', 'lock', 'network', 'compensation']);
export type SpanKind = z.infer<typeof SpanKind>;

export const TraceSpan = z.object({
  nodeId: z.string(),
  label: z.string(),
  kind: SpanKind,
  startMs: z.number(),
  endMs: z.number(),
});
export type TraceSpan = z.infer<typeof TraceSpan>;

export const TraceMsg = z.object({
  type: z.literal('trace'),
  txId: z.string(),
  endpointId: z.string(),
  outcome: TxOutcome,
  spans: z.array(TraceSpan),
});
export type TraceMsg = z.infer<typeof TraceMsg>;

export const FinishedMsg = z.object({ type: z.literal('finished'), t: z.number() });
export const ErrorMsg = z.object({ type: z.literal('error'), code: z.string(), message: z.string() });
export type ErrorMsg = z.infer<typeof ErrorMsg>;

export const EngineMessage = z.discriminatedUnion('type', [
  TickMsg,
  FlowsMsg,
  AlertMsg,
  ViolationMsg,
  TraceMsg,
  FinishedMsg,
  ErrorMsg,
]);
export type EngineMessage = z.infer<typeof EngineMessage>;

/* ===================== Команды фронтенда (WebSocket) ===================== */

export type EngineCommand =
  | { type: 'start'; schema: Schema; speed: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'setSpeed'; speed: number }
  /** Изменение схемы на лету: отправляется схема целиком, движок сам находит разницу по id. */
  | { type: 'patch'; schema: Schema }
  | { type: 'injectFault'; faultId: string; action: FaultAction; durationS?: number }
  | { type: 'clearFault'; faultId: string }
  | { type: 'setLoad'; clientId: string; rps: number }
  | { type: 'getTrace'; txId: string };

/* ===================== REST (6.2) ===================== */

export interface ValidateResponse {
  issues: Issue[];
}

export interface TemplateInfo {
  id: string;
  kind: 'template' | 'task';
  /** Ключ названия в i18n либо готовая строка от движка. */
  name: string;
  description: string;
}

export interface ExperimentConfig {
  schema: Schema;
  /** Эндпоинт, транзакция которого перебирается по паттернам. */
  endpointId: string;
  patterns: TxPattern[];
  /** Уровни суммарной нагрузки, RPS. */
  loadLevels: number[];
  faults: ScheduledFault[];
  repeats: number;
  durationS: number;
  baseSeed: number;
}

export type ExperimentStatus = 'queued' | 'running' | 'done' | 'cancelled' | 'failed';

export interface ExperimentProgress {
  id: string;
  status: ExperimentStatus;
  done: number;
  total: number;
  etaS: number;
  error?: string;
}

export interface Stat {
  mean: number;
  std: number;
}

export interface ExperimentRow {
  pattern: TxPattern;
  load: number;
  throughput: Stat;
  p50: Stat;
  p95: Stat;
  p99: Stat;
  successPct: Stat;
  compensatedPct: Stat;
  rolledBackPct: Stat;
  stuckPct: Stat;
  violations: Stat;
  messagesPerTx: Stat;
  /** Время восстановления после отказа, с (null — отказов не было). */
  recoveryS: Stat | null;
}

export interface ExperimentReport {
  id: string;
  createdAt: string;
  projectName: string;
  endpointName: string;
  config: Omit<ExperimentConfig, 'schema'>;
  rows: ExperimentRow[];
}

/* ===================== Клиент движка ===================== */

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export type MessageListener = (msg: EngineMessage) => void;
export type StatusListener = (status: ConnectionStatus) => void;

/** Единая точка обмена с движком. Две реализации: MockEngineClient и WsEngineClient. */
export interface EngineClient {
  readonly kind: 'mock' | 'ws';

  /* --- интерактивный запуск (WebSocket, 6.3) --- */
  send(cmd: EngineCommand): void;
  onMessage(listener: MessageListener): () => void;
  onStatus(listener: StatusListener): () => void;
  status(): ConnectionStatus;

  /* --- разовые операции (REST, 6.2) --- */
  validate(schema: Schema): Promise<ValidateResponse>;
  listTemplates(): Promise<TemplateInfo[]>;
  getTemplate(id: string): Promise<Schema>;
  createExperiment(config: ExperimentConfig): Promise<{ id: string }>;
  getExperiment(id: string): Promise<ExperimentProgress>;
  getReport(id: string): Promise<ExperimentReport>;
  cancelExperiment(id: string): Promise<void>;
}
