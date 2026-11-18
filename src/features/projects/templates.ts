/**
 * Шаблоны проектов (ТЗ 5.15). Пока движка нет, они лежат здесь; позже их отдаёт
 * `GET /api/templates` — mock-клиент возвращает отсюда же, UI разницы не видит.
 * Названия шаблонов — ключи i18n `templates.<id>.*`; содержимое (имена узлов) — данные проекта.
 */
import { defaultParams } from '@/schema/params';
import {
  SCHEMA_VERSION,
  type Endpoint,
  type NodeKind,
  type ParamValue,
  type Schema,
  type SchemaEdge,
  type SchemaNode,
  type Step,
  type Transaction,
} from '@/schema/types';

function node(
  id: string,
  kind: NodeKind,
  name: string,
  x: number,
  y: number,
  params: Record<string, ParamValue> = {},
): SchemaNode {
  return { id, kind, name, position: { x, y }, params: { ...defaultParams(kind), ...params } };
}

function edge(source: string, target: string, latencyMs = 1): SchemaEdge {
  return { id: `e-${source}-${target}`, source, target, kind: 'call', network: { latencyMs, lossPct: 0 } };
}

function step(id: string, type: Step['type'], targetId: string | null, extra: Partial<Step> = {}): Step {
  return { id, type, targetId, durationMs: 0, ...extra };
}

function tx(from: string, to: string, pattern: Transaction['pattern'], coordinatorId: string | null = null): Transaction {
  return {
    fromStepId: from,
    toStepId: to,
    pattern,
    coordinatorId,
    options: { outbox: false, idempotentConsumers: false, phaseTimeoutMs: 500, retries: 2 },
  };
}

function ep(id: string, serviceId: string, name: string, trigger: Endpoint['trigger'], steps: Step[], transaction: Transaction | null = null): Endpoint {
  return { id, serviceId, name, trigger, steps, transaction };
}

/** «Интернет-магазин»: Order → Payment → Inventory → Shipping. */
export function eshopTemplate(): Schema {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: { name: 'Интернет-магазин', description: 'Order → Payment → Inventory → Shipping' },
    nodes: [
      node('client', 'client', 'Покупатели', 0, 230),
      node('order', 'service', 'Order', 260, 230),
      node('orders-db', 'database', 'orders-db', 260, 430, { tables: 'orders', pool: 30 }),
      node('payment', 'service', 'Payment', 520, 40),
      node('payments-db', 'database', 'payments-db', 780, 40, { tables: 'accounts, payments', pool: 8 }),
      node('inventory', 'service', 'Inventory', 520, 230),
      node('inventory-db', 'database', 'inventory-db', 780, 230, { tables: 'inventory', pool: 16 }),
      node('events', 'broker', 'events', 520, 410),
      node('shipping', 'service', 'Shipping', 780, 410),
      node('shipping-db', 'database', 'shipping-db', 1040, 410, { tables: 'shipments' }),
    ],
    edges: [
      edge('client', 'order', 5),
      edge('order', 'orders-db'),
      edge('order', 'payment'),
      edge('order', 'inventory'),
      edge('order', 'events'),
      edge('payment', 'payments-db'),
      edge('inventory', 'inventory-db'),
      edge('events', 'shipping'),
      edge('shipping', 'shipping-db'),
    ],
    endpoints: [
      ep(
        'ep-create-order',
        'order',
        'POST /orders',
        { type: 'http', method: 'POST' },
        [
          step('s-co-1', 'dbWrite', 'orders-db', { action: 'createOrder' }),
          step('s-co-2', 'call', 'payment', { targetEndpointId: 'ep-pay' }),
          step('s-co-3', 'call', 'inventory', { targetEndpointId: 'ep-reserve' }),
          step('s-co-4', 'dbWrite', 'orders-db', { action: 'markOrderPaid' }),
          step('s-co-5', 'publish', 'events', { topic: 'order.paid' }),
        ],
        tx('s-co-1', 's-co-4', 'sagaOrchestration', 'order'),
      ),
      ep('ep-get-order', 'order', 'GET /orders/{id}', { type: 'http', method: 'GET' }, [
        step('s-go-1', 'dbRead', 'orders-db', { action: 'readOrder' }),
      ]),
      ep(
        'ep-pay',
        'payment',
        'POST /payments',
        { type: 'http', method: 'POST' },
        [
          step('s-p-1', 'dbWrite', 'payments-db', { action: 'debitAccount' }),
          step('s-p-2', 'dbWrite', 'payments-db', { action: 'creditAccount' }),
          step('s-p-3', 'dbWrite', 'payments-db', { action: 'createPayment' }),
        ],
        tx('s-p-1', 's-p-3', 'local'),
      ),
      ep('ep-reserve', 'inventory', 'POST /reservations', { type: 'http', method: 'POST' }, [
        step('s-r-1', 'dbRead', 'inventory-db', { action: 'readStock' }),
        step('s-r-2', 'dbWrite', 'inventory-db', { action: 'reserveStock' }),
      ]),
      ep('ep-ship', 'shipping', 'on order.paid', { type: 'message', topic: 'order.paid' }, [
        step('s-sh-1', 'compute', null, { durationMs: 3 }),
        step('s-sh-2', 'dbWrite', 'shipping-db', { action: 'createShipment' }),
      ]),
    ],
    workload: [
      {
        clientId: 'client',
        profile: 'constant',
        rps: 150,
        mix: [
          { endpointId: 'ep-create-order', pct: 70 },
          { endpointId: 'ep-get-order', pct: 30 },
        ],
      },
    ],
    faults: [],
    invariants: [
      { id: 'inv-money', type: 'moneyConserved', table: 'accounts', field: 'balance' },
      { id: 'inv-stock', type: 'nonNegative', table: 'inventory', field: 'stock' },
      { id: 'inv-paid', type: 'paidReserved', table: 'orders', field: 'status' },
    ],
    seed: 42,
    task: { minRps: 600, maxP99Ms: 300, maxViolations: 0, holdS: 30 },
  };
}

/** «Банковский перевод»: два счёта в одной БД — после шардирования перевод становится распределённым. */
export function bankTemplate(): Schema {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: { name: 'Банковский перевод', description: 'Transfer: списать → зачислить' },
    nodes: [
      node('client', 'client', 'Клиенты банка', 0, 200),
      node('transfer', 'service', 'Transfer', 260, 200),
      node('ledger', 'service', 'Ledger', 520, 60),
      node('accounts-db', 'database', 'accounts-db', 520, 300, { tables: 'accounts', pool: 10 }),
      node('ledger-db', 'database', 'ledger-db', 780, 60, { tables: 'payments' }),
    ],
    edges: [
      edge('client', 'transfer', 5),
      edge('transfer', 'accounts-db'),
      edge('transfer', 'ledger'),
      edge('ledger', 'ledger-db'),
    ],
    endpoints: [
      ep(
        'ep-transfer',
        'transfer',
        'POST /transfers',
        { type: 'http', method: 'POST' },
        [
          step('s-t-1', 'dbRead', 'accounts-db', { action: 'readAccount' }),
          step('s-t-2', 'dbWrite', 'accounts-db', { action: 'debitAccount' }),
          step('s-t-3', 'dbWrite', 'accounts-db', { action: 'creditAccount' }),
          step('s-t-4', 'call', 'ledger', { targetEndpointId: 'ep-ledger' }),
        ],
        tx('s-t-2', 's-t-3', 'local'),
      ),
      ep('ep-balance', 'transfer', 'GET /accounts/{id}', { type: 'http', method: 'GET' }, [
        step('s-b-1', 'dbRead', 'accounts-db', { action: 'readAccount' }),
      ]),
      ep('ep-ledger', 'ledger', 'POST /entries', { type: 'http', method: 'POST' }, [
        step('s-l-1', 'dbWrite', 'ledger-db', { action: 'createPayment' }),
      ]),
    ],
    workload: [
      {
        clientId: 'client',
        profile: 'constant',
        rps: 200,
        mix: [
          { endpointId: 'ep-transfer', pct: 60 },
          { endpointId: 'ep-balance', pct: 40 },
        ],
      },
    ],
    faults: [],
    invariants: [
      { id: 'inv-money', type: 'moneyConserved', table: 'accounts', field: 'balance' },
      { id: 'inv-once', type: 'exactlyOnceDebit', table: 'payments', field: 'amount' },
    ],
    seed: 7,
  };
}

/** «Бронирование поездки»: хореографическая сага через брокер. */
export function travelTemplate(): Schema {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: { name: 'Бронирование поездки', description: 'Trip → Flight → Hotel → Payment' },
    nodes: [
      node('client', 'client', 'Путешественники', 0, 220),
      node('gw', 'gateway', 'API Gateway', 240, 220),
      node('trip', 'service', 'Trip', 480, 220),
      node('trips-db', 'database', 'trips-db', 480, 440, { tables: 'orders' }),
      node('bus', 'broker', 'trip-events', 720, 220, { duplicatePct: 2 }),
      node('flight', 'service', 'Flight', 960, 40),
      node('flights-db', 'database', 'flights-db', 1200, 40, { tables: 'flights' }),
      node('hotel', 'service', 'Hotel', 960, 220),
      node('hotels-db', 'database', 'hotels-db', 1200, 220, { tables: 'hotels' }),
      node('pay', 'service', 'Payment', 960, 400),
      node('pay-db', 'database', 'payments-db', 1200, 400, { tables: 'accounts, payments' }),
    ],
    edges: [
      edge('client', 'gw', 5),
      edge('gw', 'trip'),
      edge('trip', 'trips-db'),
      edge('trip', 'bus'),
      edge('bus', 'flight'),
      edge('bus', 'hotel'),
      edge('bus', 'pay'),
      edge('flight', 'flights-db'),
      edge('hotel', 'hotels-db'),
      edge('pay', 'pay-db'),
    ],
    endpoints: [
      ep(
        'ep-book',
        'trip',
        'POST /trips',
        { type: 'http', method: 'POST' },
        [
          step('s-bk-1', 'dbWrite', 'trips-db', { action: 'createOrder' }),
          step('s-bk-2', 'publish', 'bus', { topic: 'trip.created' }),
        ],
        tx('s-bk-1', 's-bk-2', 'sagaChoreography'),
      ),
      ep('ep-flight', 'flight', 'on trip.created', { type: 'message', topic: 'trip.created' }, [
        step('s-f-1', 'dbWrite', 'flights-db', { action: 'bookFlight' }),
      ]),
      ep('ep-hotel', 'hotel', 'on trip.created', { type: 'message', topic: 'trip.created' }, [
        step('s-h-1', 'dbWrite', 'hotels-db', { action: 'bookHotel' }),
      ]),
      ep('ep-charge', 'pay', 'on trip.created', { type: 'message', topic: 'trip.created' }, [
        step('s-c-1', 'dbWrite', 'pay-db', { action: 'debitAccount' }),
        step('s-c-2', 'dbWrite', 'pay-db', { action: 'createPayment' }),
      ]),
    ],
    workload: [{ clientId: 'client', profile: 'constant', rps: 120, mix: [{ endpointId: 'ep-book', pct: 100 }] }],
    faults: [],
    invariants: [
      { id: 'inv-once', type: 'exactlyOnceDebit', table: 'payments', field: 'amount' },
      { id: 'inv-money', type: 'moneyConserved', table: 'accounts', field: 'balance' },
    ],
    seed: 11,
  };
}

export const TEMPLATES = [
  { id: 'eshop', build: eshopTemplate },
  { id: 'bank', build: bankTemplate },
  { id: 'travel', build: travelTemplate },
] as const;

export type TemplateId = (typeof TEMPLATES)[number]['id'];
