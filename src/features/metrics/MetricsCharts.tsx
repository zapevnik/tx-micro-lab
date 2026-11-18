/**
 * Графики (ТЗ 5.12): глобальные за последние 60 с виртуального времени и графики выбранного узла.
 * Изменения схемы во время запуска — вертикальные линии «до и после» (5.8).
 */
import { useMemo } from 'react';
import { AXIS_STYLE, BASE_OPTION, Chart, type ChartOption } from '@/components/Chart';
import { Empty } from '@/components/ui';
import { fmt, fmtCompact, t } from '@/i18n';
import { useSim, WINDOW_S, type GlobalPoint, type Marker } from '@/store/sim';

interface SeriesDef {
  name: string;
  color: string;
  /** [t, y] или [t, y, исходное значение для подсказки] */
  data: number[][];
  area?: boolean;
  /** Сплошная заливка (для ручного стека «исходов»). */
  solid?: boolean;
}

function timeOption(series: SeriesDef[], markers: Marker[], now: number, opts: { yMax?: number; unit?: string } = {}): ChartOption {
  const min = Math.max(0, now - WINDOW_S);
  return {
    ...BASE_OPTION,
    tooltip: {
      ...BASE_OPTION.tooltip,
      valueFormatter: (v: number) => `${fmt(v)}${opts.unit ? ' ' + opts.unit : ''}`,
    },
    xAxis: {
      type: 'value',
      min,
      max: Math.max(min + WINDOW_S, now),
      ...AXIS_STYLE,
      splitLine: { show: false },
      axisLabel: { ...AXIS_STYLE.axisLabel, formatter: (v: number) => `${Math.round(v)}с` },
    },
    yAxis: { type: 'value', min: 0, max: opts.yMax, ...AXIS_STYLE, axisLabel: { ...AXIS_STYLE.axisLabel, formatter: (v: number) => fmtCompact(v) } },
    series: series.map((s, i) => ({
      name: s.name,
      type: 'line',
      showSymbol: false,
      smooth: s.solid ? false : 0.2,
      data: s.data,
      lineStyle: { width: s.solid ? 0.8 : 1.6, color: s.color },
      itemStyle: { color: s.color },
      areaStyle: s.area ? { color: s.color, opacity: s.solid ? 0.9 : 0.12 } : undefined,
      markLine:
        i === 0 && markers.length
          ? {
              symbol: 'none',
              silent: true,
              lineStyle: { color: '#f8fafc', type: 'dashed', width: 1, opacity: 0.55 },
              label: { show: true, formatter: (p: { name: string }) => p.name, color: '#cbd5e1', fontSize: 9, position: 'insideEndTop' },
              data: markers.map((m) => ({ xAxis: m.t, name: m.label })),
            }
          : undefined,
    })),
  };
}

const OUTCOMES = [
  { key: 'committed', color: '#16a34a' },
  { key: 'compensated', color: '#ea580c' },
  { key: 'rolledBack', color: '#0284c7' },
  { key: 'stuck', color: '#7c3aed' },
  { key: 'failed', color: '#e11d48' },
] as const;

/**
 * Доли исходов транзакций — стек считается вручную (накопленные суммы), а слои рисуются
 * от верхнего к нижнему: так заливки не зависят от того, как ECharts стекует числовую ось.
 */
function outcomesOption(history: GlobalPoint[], markers: Marker[], now: number): ChartOption {
  const cum = history.map((p) => {
    const total = p.committed + p.rolledBack + p.compensated + p.stuck + p.failed;
    let acc = 0;
    return OUTCOMES.map((o) => {
      const v = total > 0 ? (p[o.key] / total) * 100 : 0;
      acc += v;
      return { cum: acc, v };
    });
  });
  const series: SeriesDef[] = OUTCOMES.map((o, i) => ({
    name: t(`charts.series.${o.key}`),
    color: o.color,
    area: true,
    solid: true,
    data: history.map((p, k) => [p.t, cum[k][i].cum, cum[k][i].v]),
  })).reverse();
  const opt = timeOption(series, markers, now, { yMax: 100 });
  return {
    ...opt,
    tooltip: {
      ...BASE_OPTION.tooltip,
      formatter: (params: { marker: string; seriesName: string; data: number[] }[]) =>
        [...params]
          .reverse()
          .map((p) => `${p.marker}${p.seriesName}: ${fmt(p.data[2], 1)}%`)
          .join('<br/>'),
    },
  };
}

export function GlobalCharts() {
  const history = useSim((s) => s.history);
  const markers = useSim((s) => s.markers);
  const now = useSim((s) => s.t);

  const options = useMemo(() => {
    const pick = (f: (p: (typeof history)[number]) => number): [number, number][] => history.map((p) => [p.t, f(p)]);
    return [
      {
        title: t('charts.throughput'),
        option: timeOption([{ name: t('charts.series.throughput'), color: '#38bdf8', data: pick((p) => p.throughput), area: true }], markers, now),
      },
      {
        title: t('charts.latency'),
        option: timeOption(
          [
            { name: t('charts.series.p50'), color: '#4ade80', data: pick((p) => p.p50) },
            { name: t('charts.series.p95'), color: '#facc15', data: pick((p) => p.p95) },
            { name: t('charts.series.p99'), color: '#f87171', data: pick((p) => p.p99) },
          ],
          markers,
          now,
          { unit: t('units.ms') },
        ),
      },
      {
        title: t('charts.outcomes'),
        option: outcomesOption(history, markers, now),
      },
      {
        title: t('charts.errors'),
        option: timeOption(
          [
            { name: t('charts.series.errors'), color: '#f43f5e', data: pick((p) => p.errorsPerS) },
            { name: t('charts.series.violations'), color: '#e879f9', data: pick((p) => p.violationsTotal) },
          ],
          markers,
          now,
        ),
      },
    ];
  }, [history, markers, now]);

  if (!history.length) return <Empty>{t('charts.noData')}</Empty>;
  return (
    <div className="grid h-full grid-cols-4 gap-2 p-2" data-testid="global-charts">
      {options.map((o) => (
        <div key={o.title} className="flex min-h-0 flex-col rounded-md border border-border bg-card/40">
          <div className="px-2 pt-1.5 text-[11px] font-medium text-muted-foreground">{o.title}</div>
          <Chart option={o.option} notMerge className="min-h-0 flex-1" />
        </div>
      ))}
    </div>
  );
}

export function NodeCharts({ nodeId, isDb }: { nodeId: string; isDb: boolean }) {
  const history = useSim((s) => s.nodeHistory[nodeId]);
  const markers = useSim((s) => s.markers);
  const now = useSim((s) => s.t);

  const charts = useMemo(() => {
    if (!history) return [];
    const pick = (f: (p: (typeof history)[number]) => number): [number, number][] => history.map((p) => [p.t, f(p)]);
    const list = [
      { title: t('charts.nodeLoad'), option: timeOption([{ name: t('charts.series.load'), color: '#f59e0b', data: pick((p) => p.load), area: true }], markers, now, { unit: '%' }) },
      { title: t('charts.nodeRps'), option: timeOption([{ name: t('charts.series.rps'), color: '#38bdf8', data: pick((p) => p.rps), area: true }], markers, now) },
      {
        title: t('charts.nodeLatency'),
        option: timeOption(
          [
            { name: t('charts.series.p50'), color: '#4ade80', data: pick((p) => p.p50) },
            { name: t('charts.series.p99'), color: '#f87171', data: pick((p) => p.p99) },
          ],
          markers,
          now,
          { unit: t('units.ms') },
        ),
      },
      {
        title: t('charts.nodeQueue'),
        option: timeOption(
          [
            { name: t('charts.series.queue'), color: '#a78bfa', data: pick((p) => p.queue) },
            ...(isDb ? [{ name: t('charts.series.locks'), color: '#fb7185', data: pick((p) => p.locks) }] : []),
          ],
          markers,
          now,
        ),
      },
    ];
    return list;
  }, [history, markers, now, isDb]);

  if (!history?.length) return <Empty>{t('charts.noData')}</Empty>;
  return (
    <div className="space-y-2 p-2">
      {charts.map((c) => (
        <div key={c.title} className="rounded-md border border-border bg-card/40">
          <div className="px-2 pt-1.5 text-[11px] font-medium text-muted-foreground">{c.title}</div>
          <Chart option={c.option} notMerge className="h-32" />
        </div>
      ))}
    </div>
  );
}
