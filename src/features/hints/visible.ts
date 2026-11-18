/**
 * Какие подсказки показывать на холсте: не больше MAX_VISIBLE самых важных и по одной на код,
 * чтобы при каскадном отказе холст не превращался в стену всплывающих окон.
 * Остальные подсказки всё равно попадают в журнал событий.
 */
import type { AlertMsg } from '@/engine/types';
import { alertKey } from '@/store/sim';

const MAX_VISIBLE = 1;

export const ALERT_PRIORITY: Record<string, number> = {
  coordinatorDown: 0,
  dbOverload: 1,
  locksStuck: 2,
  serviceOverload: 3,
  duplicateDelivery: 4,
  crossShardTx: 5,
  brokerBacklog: 6,
  replicaLag: 7,
  nodeDown: 8,
};

let cacheIn: [Record<string, AlertMsg>, Record<string, true>] | null = null;
let cacheOut = new Set<string>();

export function visibleAlertKeys(alerts: Record<string, AlertMsg>, dismissed: Record<string, true>): Set<string> {
  if (cacheIn && cacheIn[0] === alerts && cacheIn[1] === dismissed) return cacheOut;
  const list = Object.values(alerts)
    .filter((a) => !dismissed[alertKey(a)])
    .sort((a, b) => (ALERT_PRIORITY[a.code] ?? 9) - (ALERT_PRIORITY[b.code] ?? 9) || a.nodeId.localeCompare(b.nodeId));
  const seenCodes = new Set<string>();
  const out = new Set<string>();
  for (const a of list) {
    if (seenCodes.has(a.code)) continue;
    seenCodes.add(a.code);
    out.add(alertKey(a));
    if (out.size >= MAX_VISIBLE) break;
  }
  cacheIn = [alerts, dismissed];
  cacheOut = out;
  return out;
}
