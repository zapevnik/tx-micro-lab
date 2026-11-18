/**
 * Режим сравнения (ТЗ 5.13): мастер запуска → прогресс → отчёт (таблица, графики «от нагрузки»,
 * столбцы по нарушениям, сообщениям и восстановлению) → экспорт CSV и PNG. Отчёты сохраняются.
 * Работает через EngineClient (REST 6.2), поэтому с настоящим движком меняться не придётся.
 */
import { ArrowLeft, Download, FileSpreadsheet, Image, Loader2, Play, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '@/app/router';
import { AXIS_STYLE, BASE_OPTION, Chart, type ChartHandle, type ChartOption } from '@/components/Chart';
import { Button, Input, Label, Select } from '@/components/ui';
import { getEngine } from '@/engine';
import type { ExperimentProgress, ExperimentReport, ExperimentRow, Stat } from '@/engine/types';
import { projectsRepo, reportsRepo, type ReportRecord } from '@/features/projects/storage';
import { fmt, fmtDate, t } from '@/i18n';
import { cn, downloadText, downloadUrl, safeFilename, toCsv } from '@/lib/utils';
import { nodeById, txSteps } from '@/schema/analysis';
import { TX_PATTERNS, type ScheduledFault, type TxPattern } from '@/schema/types';
import { hasErrors } from '@/schema/validate';
import { project, useProject } from '@/store/project';
import { ui } from '@/store/ui';

type FaultPreset = 'none' | 'schema' | 'coordinator' | 'participant';

const PATTERN_COLORS: Record<TxPattern, string> = {
  none: '#94a3b8',
  local: '#22d3ee',
  '2pc': '#f472b6',
  sagaOrchestration: '#a3e635',
  sagaChoreography: '#c084fc',
  tcc: '#fbbf24',
};

export function CompareScreen({ projectId }: { projectId: string }) {
  const loadedId = useProject((s) => s.projectId);
  useEffect(() => {
    if (loadedId !== projectId)
      projectsRepo.get(projectId).then((rec) => (rec ? project().load(rec.id, rec.schema) : navigate({ screen: 'start' })));
  }, [projectId, loadedId]);
  if (loadedId !== projectId) return null;
  return <Compare projectId={projectId} />;
}

function Compare({ projectId }: { projectId: string }) {
  const schema = useProject((s) => s.schema);
  const issues = useProject((s) => s.issues);
  const txEndpoints = schema.endpoints.filter((e) => e.transaction);
  const [endpointId, setEndpointId] = useState(txEndpoints[0]?.id ?? '');
  const [patterns, setPatterns] = useState<TxPattern[]>(['2pc', 'sagaOrchestration', 'sagaChoreography']);
  const [loadsText, setLoadsText] = useState('100, 300, 500, 700');
  const [faultPreset, setFaultPreset] = useState<FaultPreset>(schema.faults.length ? 'schema' : 'none');
  const [repeats, setRepeats] = useState(3);
  const [duration, setDuration] = useState(60);
  const [baseSeed, setBaseSeed] = useState(schema.seed);
  const [progress, setProgress] = useState<ExperimentProgress | null>(null);
  const [report, setReport] = useState<ExperimentReport | null>(null);
  const [saved, setSaved] = useState<ReportRecord[]>([]);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const loads = useMemo(
    () =>
      loadsText
        .split(/[,;\s]+/)
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0),
    [loadsText],
  );

  useEffect(() => {
    reportsRepo.list(projectId).then(setSaved, () => setSaved([]));
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, [projectId]);

  const faults = (): ScheduledFault[] => {
    const ep = schema.endpoints.find((e) => e.id === endpointId);
    if (faultPreset === 'schema') return schema.faults;
    if (faultPreset === 'coordinator' && ep)
      return [{ id: 'preset-coord', atS: 20, durationS: 10, action: { type: 'coordinatorCrash', endpointId: ep.id, after: 'prepare' } }];
    if (faultPreset === 'participant' && ep) {
      const target = txSteps(ep).find((s) => s.type === 'call')?.targetId ?? txSteps(ep).find((s) => s.type === 'dbWrite')?.targetId;
      if (target) return [{ id: 'preset-part', atS: 20, durationS: 10, action: { type: 'nodeDown', nodeId: target } }];
    }
    return [];
  };

  const valid = endpointId && patterns.length >= 2 && patterns.length <= 5 && loads.length > 0 && !hasErrors(issues);
  const total = patterns.length * loads.length * repeats;

  const run = async () => {
    const engine = getEngine();
    setReport(null);
    const { id } = await engine.createExperiment({
      schema,
      endpointId,
      patterns,
      loadLevels: loads,
      faults: faults(),
      repeats,
      durationS: duration,
      baseSeed,
    });
    setProgress({ id, status: 'running', done: 0, total, etaS: 0 });
    poll.current = setInterval(async () => {
      try {
        const p = await engine.getExperiment(id);
        setProgress(p);
        if (p.status === 'running' || p.status === 'queued') return;
        clearInterval(poll.current!);
        poll.current = null;
        if (p.status === 'done') {
          const r = await engine.getReport(id);
          setReport(r);
          setProgress(null);
          await reportsRepo.put({ id: r.id, projectId, report: r });
          setSaved(await reportsRepo.list(projectId));
        } else if (p.status === 'cancelled') {
          ui().toast(t('compare.cancelled'), 'warn');
          setProgress(null);
        } else ui().toast(t('compare.failed', { error: p.error ?? '' }), 'error');
      } catch (e) {
        clearInterval(poll.current!);
        ui().toast(t('compare.failed', { error: String(e) }), 'error');
        setProgress(null);
      }
    }, 250);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card/60 px-3">
        <Button variant="ghost" size="sm" onClick={() => navigate({ screen: 'editor', projectId })}>
          <ArrowLeft /> {t('compare.back')}
        </Button>
        <div className="font-semibold">{t('compare.title')}</div>
        <div className="text-sm text-muted-foreground">· {schema.meta.name}</div>
        <div className="ml-auto text-[11px] text-muted-foreground">{getEngine().kind === 'mock' && t('compare.mockNote')}</div>
      </header>
      <div className="flex min-h-0 flex-1">
        {/* Мастер */}
        <aside className="w-80 shrink-0 space-y-4 overflow-y-auto border-r border-border bg-card/40 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('compare.wizard')}</div>
          <Field label={t('compare.schema')}>
            <div className="text-sm">{schema.meta.name}</div>
          </Field>
          <Field label={t('compare.transaction')}>
            {txEndpoints.length === 0 ? (
              <div className="text-xs text-amber-300">{t('compare.noTransactions')}</div>
            ) : (
              <Select value={endpointId} onChange={(e) => setEndpointId(e.target.value)} data-testid="cmp-endpoint">
                {txEndpoints.map((e) => (
                  <option key={e.id} value={e.id}>
                    {nodeById(schema, e.serviceId)?.name} · {e.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('compare.patterns')}>
            <div className="space-y-1">
              {TX_PATTERNS.map((p) => (
                <label key={p} className="flex cursor-pointer items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    className="accent-sky-400"
                    checked={patterns.includes(p)}
                    onChange={(e) => setPatterns(e.target.checked ? [...patterns, p] : patterns.filter((x) => x !== p))}
                  />
                  <span className="inline-block size-2.5 rounded-sm" style={{ background: PATTERN_COLORS[p] }} />
                  {t(`tx.patterns.${p}`)}
                </label>
              ))}
            </div>
          </Field>
          <Field label={t('compare.loads')}>
            <Input value={loadsText} onChange={(e) => setLoadsText(e.target.value)} />
            <div className="text-[11px] text-muted-foreground">{t('compare.loadsHint')}</div>
          </Field>
          <Field label={t('compare.faults')}>
            <Select value={faultPreset} onChange={(e) => setFaultPreset(e.target.value as FaultPreset)}>
              <option value="none">{t('compare.faultsNone')}</option>
              <option value="schema" disabled={!schema.faults.length}>
                {t('compare.faultsFromSchema', { n: schema.faults.length })}
              </option>
              <option value="coordinator">{t('compare.faultsCoordinator')}</option>
              <option value="participant">{t('compare.faultsParticipant')}</option>
            </Select>
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label={t('compare.repeats')}>
              <Input type="number" min={1} max={20} value={repeats} onChange={(e) => setRepeats(Math.min(20, Math.max(1, Number(e.target.value) || 1)))} />
            </Field>
            <Field label={t('compare.duration')}>
              <Input type="number" min={10} max={600} value={duration} onChange={(e) => setDuration(Math.min(600, Math.max(10, Number(e.target.value) || 10)))} />
            </Field>
            <Field label={t('compare.baseSeed')}>
              <Input type="number" value={baseSeed} onChange={(e) => setBaseSeed(Math.round(Number(e.target.value) || 0))} />
            </Field>
          </div>
          {hasErrors(issues) && <div className="text-xs text-red-400">{t('compare.hasErrors')}</div>}
          <div className="text-xs text-muted-foreground">{t('compare.runs', { n: total })}</div>
          <Button className="w-full" disabled={!valid || !!progress} onClick={run} data-testid="cmp-run">
            <Play /> {t('compare.run')}
          </Button>

          <div className="border-t border-border pt-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('compare.reports')}</div>
            {saved.length === 0 && <div className="text-xs text-muted-foreground">{t('compare.noReports')}</div>}
            {saved.map((r) => (
              <div
                key={r.id}
                className={cn('group flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-accent', report?.id === r.id && 'bg-accent')}
                onClick={() => setReport(r.report)}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate">{r.report.endpointName}</div>
                  <div className="text-[10.5px] text-muted-foreground">
                    {fmtDate(r.report.createdAt)} · {r.report.config.patterns.length}×{r.report.config.loadLevels.length}×{r.report.config.repeats}
                  </div>
                </div>
                <button
                  className="cursor-pointer opacity-0 group-hover:opacity-100 hover:text-red-400"
                  onClick={(e) => {
                    e.stopPropagation();
                    reportsRepo.remove(r.id).then(() => reportsRepo.list(projectId).then(setSaved));
                    if (report?.id === r.id) setReport(null);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* Прогресс и отчёт */}
        <main className="min-w-0 flex-1 overflow-y-auto p-5">
          {progress && <ProgressView progress={progress} />}
          {!progress && report && <ReportView report={report} />}
          {!progress && !report && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('compare.wizard')} → {t('compare.run')}</div>
          )}
        </main>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ProgressView({ progress }: { progress: ExperimentProgress }) {
  const pct = progress.total ? (progress.done / progress.total) * 100 : 0;
  return (
    <div className="mx-auto mt-20 max-w-md rounded-lg border border-border bg-card/60 p-6" data-testid="cmp-progress">
      <div className="mb-3 flex items-center gap-2 font-medium">
        <Loader2 className="size-4 animate-spin text-primary" />
        {t('compare.progress', { done: progress.done, total: progress.total })}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{progress.etaS > 0 && t('compare.eta', { s: progress.etaS })}</span>
        <Button size="sm" variant="ghost" onClick={() => getEngine().cancelExperiment(progress.id)}>
          <X /> {t('compare.cancel')}
        </Button>
      </div>
    </div>
  );
}

const pm = (s: Stat, d?: number) => (s.std > 0.0005 ? `${fmt(s.mean, d)} ± ${fmt(s.std, d)}` : fmt(s.mean, d));

function ReportView({ report }: { report: ExperimentReport }) {
  const charts = useRef<Record<string, ChartHandle | null>>({});
  const { patterns, loadLevels } = report.config;
  const maxLoad = Math.max(...loadLevels);
  const rowsAt = (load: number) => patterns.map((p) => report.rows.find((r) => r.pattern === p && r.load === load)!).filter(Boolean);
  const hasRecovery = report.rows.some((r) => r.recoveryS);

  const lineOption = (pick: (r: ExperimentRow) => Stat, unit: string): ChartOption => ({
    ...BASE_OPTION,
    grid: { left: 52, right: 16, top: 30, bottom: 34 },
    tooltip: { ...BASE_OPTION.tooltip, valueFormatter: (v: number) => `${fmt(v)} ${unit}` },
    xAxis: { type: 'value', name: 'RPS', nameLocation: 'middle', nameGap: 22, ...AXIS_STYLE, splitLine: { show: false } },
    yAxis: { type: 'value', name: unit, ...AXIS_STYLE },
    series: patterns.map((p) => ({
      name: t(`tx.patterns.${p}`),
      type: 'line',
      symbolSize: 7,
      lineStyle: { width: 2, color: PATTERN_COLORS[p] },
      itemStyle: { color: PATTERN_COLORS[p] },
      data: loadLevels.map((l) => {
        const r = report.rows.find((x) => x.pattern === p && x.load === l);
        return [l, r ? pick(r).mean : null];
      }),
    })),
  });

  const barOption = (pick: (r: ExperimentRow) => number): ChartOption => ({
    ...BASE_OPTION,
    grid: { left: 48, right: 16, top: 30, bottom: 28 },
    legend: { ...BASE_OPTION.legend },
    tooltip: { ...BASE_OPTION.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'category', data: loadLevels.map((l) => `${l} RPS`), ...AXIS_STYLE },
    yAxis: { type: 'value', ...AXIS_STYLE },
    series: patterns.map((p) => ({
      name: t(`tx.patterns.${p}`),
      type: 'bar',
      itemStyle: { color: PATTERN_COLORS[p], borderRadius: [3, 3, 0, 0] },
      data: loadLevels.map((l) => {
        const r = report.rows.find((x) => x.pattern === p && x.load === l);
        return r ? Number(pick(r).toFixed(3)) : 0;
      }),
    })),
  });

  const exportCsv = () => {
    const header = ['pattern', 'load', 'throughput', 'throughput_std', 'p50', 'p95', 'p99', 'p99_std', 'success_pct', 'compensated_pct', 'rolledback_pct', 'stuck_pct', 'violations', 'violations_std', 'messages_per_tx', 'recovery_s'];
    const rows = report.rows.map((r) => [
      r.pattern,
      r.load,
      r.throughput.mean,
      r.throughput.std,
      r.p50.mean,
      r.p95.mean,
      r.p99.mean,
      r.p99.std,
      r.successPct.mean,
      r.compensatedPct.mean,
      r.rolledBackPct.mean,
      r.stuckPct.mean,
      r.violations.mean,
      r.violations.std,
      r.messagesPerTx.mean,
      r.recoveryS?.mean ?? '',
    ]);
    downloadText(`${safeFilename(report.projectName)}-compare.csv`, toCsv([header, ...rows]), 'text/csv');
  };

  const exportPng = (key: string, title: string) => {
    const url = charts.current[key]?.toPng();
    if (url) downloadUrl(`${safeFilename(report.projectName)}-${safeFilename(title)}.png`, url);
  };

  const chartList: { key: string; title: string; option: ChartOption }[] = [
    { key: 'latency', title: t('compare.latencyVsLoad'), option: lineOption((r) => r.p99, t('units.ms')) },
    { key: 'throughput', title: t('compare.throughputVsLoad'), option: lineOption((r) => r.throughput, 'tx/с') },
    { key: 'violations', title: t('compare.violations'), option: barOption((r) => r.violations.mean) },
    { key: 'messages', title: t('compare.messages'), option: barOption((r) => r.messagesPerTx.mean) },
    ...(hasRecovery ? [{ key: 'recovery', title: t('compare.recovery'), option: barOption((r) => r.recoveryS?.mean ?? 0) }] : []),
  ];

  return (
    <div className="space-y-5" data-testid="cmp-report">
      <div className="flex items-center gap-3">
        <div>
          <div className="text-base font-semibold">
            {t('compare.report')}: {report.endpointName}
          </div>
          <div className="text-xs text-muted-foreground">
            {fmtDate(report.createdAt)} · {report.config.durationS} с × {report.config.repeats} · seed {report.config.baseSeed}…
            {report.config.baseSeed + report.config.repeats - 1}
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="secondary" onClick={exportCsv} data-testid="cmp-csv">
            <FileSpreadsheet /> {t('compare.exportCsv')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => chartList.forEach((c) => exportPng(c.key, c.title))}>
            <Image /> {t('compare.exportPng')}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <div className="border-b border-border bg-card/60 px-3 py-2 text-xs font-medium text-muted-foreground">{t('compare.table')}</div>
        <table className="w-full text-xs" data-testid="cmp-table">
          <thead className="bg-card/40 text-muted-foreground">
            <tr>
              {(['pattern', 'load', 'throughput', 'p50', 'p99', 'success', 'compensated', 'rolledBack', 'stuck', 'violations', 'messages', 'recovery'] as const).map((c) => (
                <th key={c} className="whitespace-nowrap px-2.5 py-1.5 text-left font-medium">
                  {t(`compare.columns.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono">
            {loadLevels.map((l) =>
              rowsAt(l).map((r, i) => (
                <tr key={`${r.pattern}-${l}`} className={cn('border-t border-border/60', i === 0 && 'border-t-border')}>
                  <td className="whitespace-nowrap px-2.5 py-1 font-sans">
                    <span className="mr-1.5 inline-block size-2.5 rounded-sm" style={{ background: PATTERN_COLORS[r.pattern] }} />
                    {t(`tx.patterns.${r.pattern}`)}
                  </td>
                  <td className="px-2.5 py-1">{l}</td>
                  <td className="px-2.5 py-1">{pm(r.throughput, 0)}</td>
                  <td className="px-2.5 py-1">{pm(r.p50, 1)}</td>
                  <td className={cn('px-2.5 py-1', r.load === maxLoad && 'font-semibold')}>{pm(r.p99, 1)}</td>
                  <td className="px-2.5 py-1">{fmt(r.successPct.mean, 1)}</td>
                  <td className="px-2.5 py-1">{fmt(r.compensatedPct.mean, 2)}</td>
                  <td className="px-2.5 py-1">{fmt(r.rolledBackPct.mean, 2)}</td>
                  <td className="px-2.5 py-1">{fmt(r.stuckPct.mean, 2)}</td>
                  <td className={cn('px-2.5 py-1', r.violations.mean > 0 && 'text-fuchsia-300')}>{pm(r.violations, 0)}</td>
                  <td className="px-2.5 py-1">{fmt(r.messagesPerTx.mean, 1)}</td>
                  <td className="px-2.5 py-1">{r.recoveryS ? pm(r.recoveryS, 1) : '—'}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {chartList.map((c) => (
          <div key={c.key} className="rounded-lg border border-border bg-card/40">
            <div className="flex items-center justify-between px-3 pt-2">
              <div className="text-xs font-medium">{c.title}</div>
              <Button size="xs" variant="ghost" onClick={() => exportPng(c.key, c.title)}>
                <Download /> PNG
              </Button>
            </div>
            <Chart ref={(h) => void (charts.current[c.key] = h)} option={c.option} notMerge className="h-64" />
          </div>
        ))}
      </div>
      {!hasRecovery && <div className="text-xs text-muted-foreground">{t('compare.noRecovery')}</div>}
    </div>
  );
}
