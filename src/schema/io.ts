/**
 * Импорт и экспорт проекта в JSON (ТЗ 5.15) с проверкой версии формата.
 * Экспорт → импорт должны давать идентичную схему (критерий приёмки 9.3).
 */
import { Schema, SCHEMA_VERSION } from './types';

export type ImportResult =
  | { ok: true; schema: Schema }
  | { ok: false; reason: 'notJson' | 'noVersion' | 'newerVersion' | 'invalid'; details?: string; version?: number };

/** Миграции со старых версий формата: ключ — версия, из которой мигрируем. */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

export function parseProject(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'notJson' };
  }
  if (!raw || typeof raw !== 'object' || typeof (raw as Record<string, unknown>).schemaVersion !== 'number')
    return { ok: false, reason: 'noVersion' };
  let obj = raw as Record<string, unknown>;
  let version = obj.schemaVersion as number;
  if (version > SCHEMA_VERSION) return { ok: false, reason: 'newerVersion', version };
  while (version < SCHEMA_VERSION) {
    const m = MIGRATIONS[version];
    if (!m) return { ok: false, reason: 'invalid', details: `no migration from v${version}` };
    obj = m(obj);
    version += 1;
  }
  const res = Schema.safeParse(obj);
  if (!res.success) {
    const first = res.error.issues[0];
    return { ok: false, reason: 'invalid', details: `${first.path.join('.')}: ${first.message}` };
  }
  return { ok: true, schema: res.data };
}

export function serializeProject(schema: Schema): string {
  return JSON.stringify(schema, null, 2);
}
