/**
 * Пакетное сравнение паттернов в mock-движке (ТЗ 5.13): прогон модели без анимации
 * на каждую комбинацию «паттерн × уровень нагрузки × повтор (seed)».
 * Чистая и детерминированная функция — один и тот же конфиг даёт одинаковый отчёт (9.2).
 */
import { setPattern } from '@/schema/ops';
import type { Schema, TxPattern } from '@/schema/types';
import type { ExperimentConfig, ExperimentRow, Stat } from '../types';
import { SimModel } from './model';

export interface RunMetrics {
  throughput: number;
  p50: number;
  p95: number;
  p99: number;
  successPct: number;
  compensatedPct: number;
  rolledBackPct: number;
  stuckPct: number;
  violations: number;
  messagesPerTx: number;
  recoveryS: number | null;
}

const DT = 0.25;
const WARMUP_S = 5;

/** Схема для одного прогона: паттерн на выбранной транзакции и суммарная нагрузка. */
export function prepareRunSchema(base: Schema, endpointId: string, pattern: TxPattern, load: number, faults = base.faults): Schema {
  let s = setPattern(base, endpointId, pattern);
  const total = s.workload.reduce((a, w) => a + w.rps, 0);
  const k = total > 0 ? load / total : 0;
  s = {
    ...s,
    faults,
    workload: s.workload.map((w) => ({ ...w, rps: total > 0 ? w.rps * k : load / s.workload.length })),
  };
  return s;
}

export function runOnce(schema: Schema, seed: number, durationS: number): RunMetrics {
  const model = new SimModel(schema, seed);
  const steps = Math.round(durationS / DT);
  const p99Series: { t: number; v: number }[] = [];
  let n = 0;
  const sum = { thr: 0, p50: 0, p95: 0, p99: 0, committed: 0, compensated: 0, rolledBack: 0, stuck: 0, failed: 0, msgs: 0 };
  let violations = 0;
  for (let i = 0; i < steps; i++) {
    const { tick } = model.step(DT);
    const g = tick.global;
    violations = g.violationsTotal;
    p99Series.push({ t: tick.t, v: g.p99 });
    if (tick.t < WARMUP_S) continue;
    n++;
    sum.thr += g.throughput;
    sum.p50 += g.p50;
    sum.p95 += g.p95;
    sum.p99 += g.p99;
    sum.committed += g.committed;
    sum.compensated += g.compensated;
    sum.rolledBack += g.rolledBack;
    sum.stuck += g.stuck;
    sum.failed += g.failed;
    sum.msgs += g.messagesPerTx;
  }
  const outcomes = sum.committed + sum.compensated + sum.rolledBack + sum.stuck + sum.failed || 1;
  return {
    throughput: sum.thr / Math.max(1, n),
    p50: sum.p50 / Math.max(1, n),
    p95: sum.p95 / Math.max(1, n),
    p99: sum.p99 / Math.max(1, n),
    successPct: (sum.committed / outcomes) * 100,
    compensatedPct: (sum.compensated / outcomes) * 100,
    rolledBackPct: (sum.rolledBack / outcomes) * 100,
    stuckPct: (sum.stuck / outcomes) * 100,
    violations,
    messagesPerTx: sum.msgs / Math.max(1, n),
    recoveryS: recoveryTime(schema, p99Series, durationS),
  };
}

/** Время восстановления: от конца последнего отказа до возврата p99 к уровню до отказов (±25%). */
export function recoveryTime(schema: Schema, series: { t: number; v: number }[], durationS: number): number | null {
  if (!schema.faults.length) return null;
  const firstStart = Math.min(...schema.faults.map((f) => f.atS));
  const lastEnd = Math.max(...schema.faults.map((f) => (f.durationS === 0 ? durationS : f.atS + f.durationS)));
  if (lastEnd >= durationS) return durationS - firstStart;
  const before = series.filter((p) => p.t >= WARMUP_S && p.t < firstStart);
  const baseline = before.length ? before.reduce((a, p) => a + p.v, 0) / before.length : series[0]?.v ?? 0;
  let okRun = 0;
  for (const p of series) {
    if (p.t < lastEnd) continue;
    okRun = p.v <= baseline * 1.25 + 1 ? okRun + 1 : 0;
    if (okRun >= 4) return Math.max(0, p.t - lastEnd - (okRun - 1) * DT);
  }
  return durationS - lastEnd;
}

export function stat(values: number[]): Stat {
  if (!values.length) return { mean: 0, std: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.length > 1 ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1) : 0;
  return { mean, std: Math.sqrt(variance) };
}

export function aggregate(pattern: TxPattern, load: number, runs: RunMetrics[]): ExperimentRow {
  const s = (f: (r: RunMetrics) => number) => stat(runs.map(f));
  const rec = runs.map((r) => r.recoveryS).filter((x): x is number => x !== null);
  return {
    pattern,
    load,
    throughput: s((r) => r.throughput),
    p50: s((r) => r.p50),
    p95: s((r) => r.p95),
    p99: s((r) => r.p99),
    successPct: s((r) => r.successPct),
    compensatedPct: s((r) => r.compensatedPct),
    rolledBackPct: s((r) => r.rolledBackPct),
    stuckPct: s((r) => r.stuckPct),
    violations: s((r) => r.violations),
    messagesPerTx: s((r) => r.messagesPerTx),
    recoveryS: rec.length ? stat(rec) : null,
  };
}

/** Список всех прогонов эксперимента в детерминированном порядке. */
export function planRuns(config: ExperimentConfig): { pattern: TxPattern; load: number; seed: number }[] {
  const out: { pattern: TxPattern; load: number; seed: number }[] = [];
  for (const pattern of config.patterns)
    for (const load of config.loadLevels)
      for (let r = 0; r < config.repeats; r++) out.push({ pattern, load, seed: config.baseSeed + r });
  return out;
}
