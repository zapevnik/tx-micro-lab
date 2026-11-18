/**
 * Словарь действий над данными (ТЗ 5.5) и готовых инвариантов (5.6).
 *
 * По ТЗ словарь принадлежит движку: действия — фиксированный набор, а не произвольный код.
 * Пока движка нет, он живёт здесь; позже его можно получать от движка, сохранив тот же формат.
 * Подписи — в i18n по ключам `actions.<id>` и `invariants.<type>`.
 */
import type { InvariantType, StepType } from './types';

export interface DataAction {
  id: string;
  kind: 'read' | 'write';
  table: string;
  field?: string;
  /** Компенсирующее действие для саг и TCC: «списать» → «вернуть». */
  compensation?: string;
}

export const DATA_ACTIONS: readonly DataAction[] = [
  { id: 'readAccount', kind: 'read', table: 'accounts', field: 'balance' },
  { id: 'debitAccount', kind: 'write', table: 'accounts', field: 'balance', compensation: 'creditAccount' },
  { id: 'creditAccount', kind: 'write', table: 'accounts', field: 'balance', compensation: 'debitAccount' },
  { id: 'readOrder', kind: 'read', table: 'orders' },
  { id: 'createOrder', kind: 'write', table: 'orders', compensation: 'cancelOrder' },
  { id: 'cancelOrder', kind: 'write', table: 'orders' },
  { id: 'markOrderPaid', kind: 'write', table: 'orders', field: 'status', compensation: 'markOrderUnpaid' },
  { id: 'markOrderUnpaid', kind: 'write', table: 'orders', field: 'status' },
  { id: 'createPayment', kind: 'write', table: 'payments', field: 'amount', compensation: 'refundPayment' },
  { id: 'refundPayment', kind: 'write', table: 'payments', field: 'amount' },
  { id: 'readStock', kind: 'read', table: 'inventory', field: 'stock' },
  { id: 'reserveStock', kind: 'write', table: 'inventory', field: 'stock', compensation: 'releaseStock' },
  { id: 'releaseStock', kind: 'write', table: 'inventory', field: 'stock' },
  { id: 'createShipment', kind: 'write', table: 'shipments', compensation: 'cancelShipment' },
  { id: 'cancelShipment', kind: 'write', table: 'shipments' },
  { id: 'bookFlight', kind: 'write', table: 'flights', field: 'seats', compensation: 'cancelFlight' },
  { id: 'cancelFlight', kind: 'write', table: 'flights', field: 'seats' },
  { id: 'bookHotel', kind: 'write', table: 'hotels', field: 'rooms', compensation: 'cancelHotel' },
  { id: 'cancelHotel', kind: 'write', table: 'hotels', field: 'rooms' },
  { id: 'readCatalog', kind: 'read', table: 'products' },
];

const BY_ID = new Map(DATA_ACTIONS.map((a) => [a.id, a]));

export function getAction(id: string | null | undefined): DataAction | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** Действия, допустимые для типа шага. */
export function actionsForStep(type: StepType): DataAction[] {
  if (type === 'dbRead' || type === 'cacheRead') return DATA_ACTIONS.filter((a) => a.kind === 'read');
  if (type === 'dbWrite' || type === 'cacheWrite') return DATA_ACTIONS.filter((a) => a.kind === 'write');
  return [];
}

export function compensationOf(actionId: string | null | undefined): DataAction | undefined {
  return getAction(getAction(actionId)?.compensation);
}

export interface InvariantDef {
  type: InvariantType;
  table: string;
  field: string;
}

export const INVARIANT_DEFS: readonly InvariantDef[] = [
  { type: 'moneyConserved', table: 'accounts', field: 'balance' },
  { type: 'nonNegative', table: 'inventory', field: 'stock' },
  { type: 'paidReserved', table: 'orders', field: 'status' },
  { type: 'exactlyOnceDebit', table: 'payments', field: 'amount' },
];

/** Какие таблицы затрагивает инвариант — чтобы понимать, какие действия могут его нарушить. */
export function invariantTables(type: InvariantType): string[] {
  switch (type) {
    case 'moneyConserved':
      return ['accounts'];
    case 'nonNegative':
      return ['inventory', 'accounts'];
    case 'paidReserved':
      return ['orders', 'inventory', 'payments'];
    case 'exactlyOnceDebit':
      return ['payments', 'accounts'];
  }
}
