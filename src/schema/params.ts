/**
 * Реестр параметров элементов (ТЗ 5.2): значение по умолчанию, единицы, диапазон и то,
 * можно ли менять параметр во время запуска (5.3). Подписи и подсказки — в i18n по ключу
 * `params.<kind>.<key>`.
 *
 * Значения по умолчанию — заглушка до калибровки движка. Когда движок будет отдавать
 * свои значения, достаточно подменить `defaults` (см. `withEngineDefaults`).
 */
import type { NodeKind, ParamValue } from './types';

export interface NumberParamDef {
  key: string;
  type: 'number';
  default: number;
  min: number;
  max: number;
  integer?: boolean;
  step?: number;
  unit?: 'ms' | 's' | 'rps' | 'pct' | 'mb' | 'pcs';
  /** Можно менять «на лету» командой patch. */
  live: boolean;
}

export interface EnumParamDef {
  key: string;
  type: 'enum';
  default: string;
  options: readonly string[];
  live: boolean;
}

export interface TextParamDef {
  key: string;
  type: 'text';
  default: string;
  live: boolean;
}

export type ParamDef = NumberParamDef | EnumParamDef | TextParamDef;

export const PARAM_DEFS: Record<NodeKind, readonly ParamDef[]> = {
  client: [],
  gateway: [
    { key: 'workers', type: 'number', default: 64, min: 1, max: 4096, integer: true, unit: 'pcs', live: true },
    { key: 'routingMs', type: 'number', default: 1, min: 0, max: 1000, step: 0.1, unit: 'ms', live: true },
    { key: 'rpsLimit', type: 'number', default: 10000, min: 1, max: 1000000, integer: true, unit: 'rps', live: true },
  ],
  balancer: [
    {
      key: 'algorithm',
      type: 'enum',
      default: 'roundRobin',
      options: ['roundRobin', 'leastConnections'],
      live: true,
    },
  ],
  service: [
    { key: 'instances', type: 'number', default: 2, min: 1, max: 64, integer: true, unit: 'pcs', live: true },
    { key: 'workers', type: 'number', default: 16, min: 1, max: 1024, integer: true, unit: 'pcs', live: true },
    { key: 'baseMs', type: 'number', default: 2, min: 0.1, max: 1000, step: 0.1, unit: 'ms', live: true },
    { key: 'timeoutMs', type: 'number', default: 1000, min: 10, max: 60000, integer: true, unit: 'ms', live: true },
    { key: 'retries', type: 'number', default: 1, min: 0, max: 10, integer: true, unit: 'pcs', live: true },
  ],
  database: [
    { key: 'pool', type: 'number', default: 20, min: 1, max: 1000, integer: true, unit: 'pcs', live: true },
    { key: 'readMs', type: 'number', default: 3, min: 0.1, max: 1000, step: 0.1, unit: 'ms', live: true },
    { key: 'readJitterMs', type: 'number', default: 1, min: 0, max: 1000, step: 0.1, unit: 'ms', live: true },
    { key: 'writeMs', type: 'number', default: 8, min: 0.1, max: 1000, step: 0.1, unit: 'ms', live: true },
    { key: 'writeJitterMs', type: 'number', default: 3, min: 0, max: 1000, step: 0.1, unit: 'ms', live: true },
    {
      key: 'isolation',
      type: 'enum',
      default: 'readCommitted',
      options: ['readCommitted', 'repeatableRead', 'serializable'],
      live: false,
    },
    { key: 'tables', type: 'text', default: 'accounts', live: false },
    { key: 'initialRows', type: 'number', default: 10000, min: 0, max: 10000000, integer: true, unit: 'pcs', live: false },
  ],
  cache: [
    { key: 'capacityMb', type: 'number', default: 512, min: 1, max: 65536, integer: true, unit: 'mb', live: true },
    { key: 'ttlS', type: 'number', default: 60, min: 1, max: 86400, integer: true, unit: 's', live: true },
    { key: 'hitPct', type: 'number', default: 80, min: 0, max: 100, integer: true, unit: 'pct', live: true },
  ],
  broker: [
    { key: 'partitions', type: 'number', default: 3, min: 1, max: 128, integer: true, unit: 'pcs', live: false },
    { key: 'deliveryMs', type: 'number', default: 5, min: 0, max: 10000, step: 0.1, unit: 'ms', live: true },
    {
      key: 'semantics',
      type: 'enum',
      default: 'atLeastOnce',
      options: ['atLeastOnce', 'atMostOnce'],
      live: false,
    },
    { key: 'duplicatePct', type: 'number', default: 0, min: 0, max: 100, step: 0.5, unit: 'pct', live: true },
    { key: 'throughput', type: 'number', default: 20000, min: 1, max: 1000000, integer: true, unit: 'rps', live: true },
  ],
};

export function defaultParams(kind: NodeKind): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const d of PARAM_DEFS[kind]) out[d.key] = d.default;
  return out;
}

export function findParamDef(kind: NodeKind, key: string): ParamDef | undefined {
  return PARAM_DEFS[kind].find((d) => d.key === key);
}

/** Числовой параметр узла с подстановкой значения по умолчанию. */
export function numParam(params: Record<string, ParamValue>, kind: NodeKind, key: string): number {
  const v = params[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const def = findParamDef(kind, key);
  return def && def.type === 'number' ? def.default : 0;
}

export function strParam(params: Record<string, ParamValue>, kind: NodeKind, key: string): string {
  const v = params[key];
  if (typeof v === 'string') return v;
  const def = findParamDef(kind, key);
  return def && def.type !== 'number' ? def.default : '';
}

export type ParamError = 'notNumber' | 'notInteger' | 'belowMin' | 'aboveMax' | 'notOption';

/** Проверка значения параметра при вводе (5.3). */
export function checkParam(def: ParamDef, value: ParamValue): ParamError | null {
  if (def.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'notNumber';
    if (def.integer && !Number.isInteger(value)) return 'notInteger';
    if (value < def.min) return 'belowMin';
    if (value > def.max) return 'aboveMax';
    return null;
  }
  if (def.type === 'enum') return def.options.includes(String(value)) ? null : 'notOption';
  return null;
}
