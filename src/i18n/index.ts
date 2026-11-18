/**
 * Локализация. Все строки интерфейса берутся только отсюда (правило проекта).
 * `t` типизирован: несуществующий ключ — ошибка компиляции, в том числе для шаблонных ключей
 * вида t(`kinds.${kind}`).
 */
import { ru } from './ru';

type Dict = typeof ru;

type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];

export type TKey = Paths<Dict>;
export type TParams = Record<string, string | number>;

const dict: Dict = ru;
export const LOCALE = 'ru-RU';

function lookup(key: string): string | undefined {
  let cur: unknown = dict;
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object' && part in cur) cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof cur === 'string' ? cur : undefined;
}

function interpolate(s: string, params?: TParams): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? fmtValue(params[k]) : `{${k}}`));
}

function fmtValue(v: string | number): string {
  return typeof v === 'number' ? fmt(v) : v;
}

export function t(key: TKey, params?: TParams): string {
  return interpolate(lookup(key) ?? key, params);
}

/** Для ключей, которые известны только во время выполнения (например, код от движка). */
export function tMaybe(key: string, params?: TParams, fallback?: string): string {
  const s = lookup(key);
  return s === undefined ? (fallback ?? key) : interpolate(s, params);
}

const nf = new Map<number, Intl.NumberFormat>();
export function fmt(v: number, digits?: number): string {
  if (!Number.isFinite(v)) return '—';
  const d = digits ?? (Math.abs(v) >= 100 || Number.isInteger(v) ? 0 : Math.abs(v) >= 10 ? 1 : 2);
  let f = nf.get(d);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: d, minimumFractionDigits: 0 });
    nf.set(d, f);
  }
  return f.format(v);
}

/** Компактная запись больших чисел: 1 200 → 1,2 тыс. */
export function fmtCompact(v: number): string {
  if (Math.abs(v) < 1000) return fmt(v);
  return new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}

export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m % 60)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

export function fmtDate(iso: string | number): string {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}
