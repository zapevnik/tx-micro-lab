# Контракт фронтенда с движком моделирования

Документ для разработки Go-движка. Источник правды — TypeScript/Zod-описания:
`src/schema/types.ts` (формат схемы) и `src/engine/types.ts` (команды, сообщения, REST).
Если что-то расходится — прав код.

Все тексты для пользователя живут на фронтенде: движок присылает только коды и параметры
(`alert.code`, `trace.spans[].label`, `issue.code`).

## 1. Схема (ТЗ 6.1)

JSON с полем `schemaVersion` (сейчас `1`).

| Поле | Содержимое |
| --- | --- |
| `meta` | `{ name, description? }` |
| `nodes[]` | `{ id, kind, name, position{x,y}, params{}, groupId?, role?, index?, scaling? }`. `kind`: `client`, `gateway`, `balancer`, `service`, `database`, `cache`, `broker`. Шарды и реплики — узлы `database` с `role: shard/replica` и `groupId` = id исходной БД. У исходной БД `scaling.sharding / replication / partitioning` |
| `edges[]` | `{ id, source, target, kind: call/shard/replication, network{latencyMs, lossPct} }` |
| `endpoints[]` | `{ id, serviceId, name, trigger, steps[], transaction }`. `trigger`: `{type:'http', method}` или `{type:'message', topic}` |
| `steps[]` | `{ id, type, targetId, targetEndpointId?, topic?, action?, durationMs, compensationDurationMs? }`. `type`: `dbRead`, `dbWrite`, `call`, `publish`, `cacheRead`, `cacheWrite`, `compute`. `action` — id из словаря действий (`src/schema/dictionary.ts`) |
| `transaction` | `{ fromStepId, toStepId, pattern, coordinatorId, options{outbox, idempotentConsumers, phaseTimeoutMs, retries} }`. `pattern`: `none`, `local`, `2pc`, `sagaOrchestration`, `sagaChoreography`, `tcc` |
| `workload[]` | `{ clientId, profile: constant/ramp/spike/sine, rps, mix[{endpointId, pct}] }` |
| `faults[]` | `{ id, atS, durationS (0 — до конца), action }`, `action` — см. `FaultAction` |
| `invariants[]` | `{ id, type: moneyConserved/nonNegative/paidReserved/exactlyOnceDebit, table, field }` |
| `seed` | целое |
| `task?` | `{ minRps?, maxP99Ms?, maxViolations?, holdS }` |

Значения параметров узлов и их диапазоны — `src/schema/params.ts`. Значения по умолчанию там —
заглушка до калибровки движка.

## 2. REST (ТЗ 6.2)

| Метод | Тело / ответ |
| --- | --- |
| `POST /api/validate` | схема → `{ issues: Issue[] }`, `Issue = { severity, code, nodeId?, edgeId?, endpointId?, stepId?, params? }` |
| `GET /api/templates` | → `TemplateInfo[]` |
| `GET /api/templates/{id}` | → схема |
| `POST /api/experiments` | `ExperimentConfig` → `{ id }` |
| `GET /api/experiments/{id}` | → `ExperimentProgress { id, status, done, total, etaS, error? }` |
| `GET /api/experiments/{id}/report` | → `ExperimentReport` (строки «паттерн × нагрузка» со `Stat {mean, std}`) |
| `DELETE /api/experiments/{id}` | отмена прогона (**расширение ТЗ**) |

## 3. WebSocket `/api/ws` (ТЗ 6.3)

Команды фронтенда (JSON, поле `type`):
`start {schema, speed}`, `pause`, `resume`, `stop`, `setSpeed {speed}`,
`patch {schema}` — **схема целиком**, движок сам находит разницу по id,
`injectFault {faultId, action, durationS?}`, `clearFault {faultId}` (**расширение ТЗ**),
`setLoad {clientId, rps}`, `getTrace {txId}`.

Сообщения движка:

| `type` | Когда | Содержимое |
| --- | --- | --- |
| `tick` | каждые 100–250 мс | `t` (виртуальные секунды), `nodes{id → NodeMetrics}`, `edges{id → EdgeMetrics}`, `global` (агрегаты для графиков), `recentTx?` (последние транзакции для трассировки) |
| `flows` | рядом с tick | `items[{edgeId, dir: fwd/back, kind: request/response/message/compensation, outcome: ok/error, durationMs, delayMs}]` — до N точек в секунду |
| `alert` | при появлении и исчезновении проблемы | `{code, nodeId, active, params}` |
| `violation` | при нарушении инварианта | `{invariantId, txId, nodeId?}` |
| `trace` | ответ на `getTrace` | `{txId, endpointId, outcome, spans[{nodeId, label, kind, startMs, endMs}]}` |
| `finished` / `error` | | `{t}` / `{code, message}` |

`NodeMetrics = { rps, load (0..1+), queue, p50, p99, errorsPerS, locks?, lagMs?, backlog?, down }`.

Коды `alert`: `dbOverload`, `serviceOverload`, `brokerBacklog`, `replicaLag`, `locksStuck`,
`coordinatorDown`, `crossShardTx`, `duplicateDelivery`, `nodeDown`. Параметры, которые ждут тексты
подсказок, — см. `alerts.*` в `src/i18n/ru.ts`.

## 4. Расширения относительно ТЗ (внести в ТЗ движка)

1. Команда `clearFault` — снять отказ, наложенный `injectFault` (кнопка «Включить»).
2. `tick.global` — агрегаты для глобальных графиков, чтобы фронтенд не пересчитывал их сам.
3. `tick.recentTx` — короткий список последних транзакций для вкладки «Трассировка».
4. `DELETE /api/experiments/{id}` — отмена пакетного прогона.
