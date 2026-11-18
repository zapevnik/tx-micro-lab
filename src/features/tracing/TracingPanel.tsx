/**
 * Трассировка (ТЗ 5.11): список последних транзакций с фильтром по исходу и таймлайн в стиле
 * Jaeger — строка на узел, отрезки работы, ожидания в очереди, блокировок и компенсаций.
 * Путь выбранной транзакции подсвечивается на холсте.
 */
import { useEffect, useMemo, useState } from 'react';
import { Empty, Select } from '@/components/ui';
import type { SpanKind, TxOutcome } from '@/engine/types';
import { requestTrace } from '@/features/sim/controller';
import { fmt, t, tMaybe } from '@/i18n';
import { cn } from '@/lib/utils';
import { nodeById } from '@/schema/analysis';
import { project, useProject } from '@/store/project';
import { useSim } from '@/store/sim';

const OUTCOME_COLOR: Record<TxOutcome, string> = {
  committed: 'text-emerald-400',
  rolledBack: 'text-sky-400',
  compensated: 'text-orange-400',
  stuck: 'text-violet-400',
  violated: 'text-fuchsia-400',
  failed: 'text-red-400',
};

const SPAN_COLOR: Record<SpanKind, string> = {
  work: '#38bdf8',
  queue: '#475569',
  lock: '#f472b6',
  network: '#64748b',
  compensation: '#fb923c',
};

export function TracingPanel() {
  const recent = useSim((s) => s.recentTx);
  const traces = useSim((s) => s.traces);
  const schema = useProject((s) => s.schema);
  const [filter, setFilter] = useState<TxOutcome | 'all'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const list = useMemo(() => (filter === 'all' ? recent : recent.filter((r) => r.outcome === filter)).slice(0, 120), [recent, filter]);
  const trace = selected ? traces[selected] : undefined;

  useEffect(() => {
    if (trace) project().setHighlight(trace.endpointId);
  }, [trace]);

  if (!recent.length) return <Empty>{t('trace.empty')}</Empty>;
  return (
    <div className="flex h-full min-h-0" data-testid="tracing">
      <div className="flex w-80 shrink-0 flex-col border-r border-border">
        <div className="flex items-center gap-2 border-b border-border p-1.5">
          <span className="text-[11px] text-muted-foreground">{t('trace.filter')}</span>
          <Select className="h-7 text-xs" value={filter} onChange={(e) => setFilter(e.target.value as TxOutcome)}>
            <option value="all">{t('trace.all')}</option>
            {(Object.keys(OUTCOME_COLOR) as TxOutcome[]).map((o) => (
              <option key={o} value={o}>
                {t(`trace.outcomes.${o}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.map((tx) => {
            const ep = schema.endpoints.find((e) => e.id === tx.endpointId);
            return (
              <button
                key={tx.txId}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2 border-b border-border/50 px-2 py-1 text-left text-xs hover:bg-accent',
                  selected === tx.txId && 'bg-accent',
                )}
                onClick={() => {
                  setSelected(tx.txId);
                  requestTrace(tx.txId);
                }}
              >
                <span className="w-12 shrink-0 font-mono text-[10.5px] text-muted-foreground">{fmt(tx.t, 1)}с</span>
                <span className="min-w-0 flex-1 truncate">{ep?.name ?? tx.endpointId}</span>
                <span className={cn('shrink-0 text-[10.5px]', OUTCOME_COLOR[tx.outcome])}>{t(`trace.outcomes.${tx.outcome}`)}</span>
                <span className="w-14 shrink-0 text-right font-mono text-[10.5px]">{fmt(tx.durationMs)}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-w-0 flex-1 overflow-auto p-3">
        {!selected ? (
          <Empty>{t('trace.select')}</Empty>
        ) : !trace ? (
          <Empty>{t('trace.loading')}</Empty>
        ) : (
          <Timeline trace={trace} />
        )}
      </div>
    </div>
  );
}

function Timeline({ trace }: { trace: NonNullable<ReturnType<typeof useSim.getState>['traces'][string]> }) {
  const schema = useProject((s) => s.schema);
  const total = Math.max(1, ...trace.spans.map((s) => s.endMs));
  const rows: string[] = [];
  for (const s of trace.spans) if (!rows.includes(s.nodeId)) rows.push(s.nodeId);
  const ep = schema.endpoints.find((e) => e.id === trace.endpointId);

  return (
    <div>
      <div className="mb-2 flex items-center gap-3 text-xs">
        <span className="font-mono text-muted-foreground">{trace.txId}</span>
        <span className="font-semibold">{ep?.name}</span>
        <span className={OUTCOME_COLOR[trace.outcome]}>{t(`trace.outcomes.${trace.outcome}`)}</span>
        <span className="font-mono">{t('trace.duration', { ms: fmt(total) })}</span>
        <div className="ml-auto flex gap-2">
          {(Object.keys(SPAN_COLOR) as SpanKind[]).map((k) => (
            <span key={k} className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
              <span className="inline-block size-2.5 rounded-sm" style={{ background: SPAN_COLOR[k] }} />
              {t(`trace.kinds.${k}`)}
            </span>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        {rows.map((nodeId) => (
          <div key={nodeId} className="flex items-center gap-2">
            <div className="w-36 shrink-0 truncate text-right text-xs text-muted-foreground">{nodeById(schema, nodeId)?.name ?? nodeId}</div>
            <div className="relative h-5 flex-1 rounded bg-muted/50">
              {trace.spans
                .filter((s) => s.nodeId === nodeId)
                .map((s, i) => {
                  const [base, action] = s.label.split(':');
                  const label = action ? tMaybe(`actions.${action}`, undefined, action) : tMaybe(`trace.labels.${base}`, undefined, tMaybe(`endpoints.stepTypes.${base}`, undefined, base));
                  return (
                    <div
                      key={i}
                      title={`${label}: ${fmt(s.endMs - s.startMs)} ${t('units.ms')}`}
                      className={cn('absolute top-0.5 h-4 overflow-hidden rounded-sm px-1 text-[9.5px] leading-4 text-slate-950', s.kind === 'lock' && 'top-3 h-1.5 opacity-80')}
                      style={{
                        left: `${(s.startMs / total) * 100}%`,
                        width: `max(2px, ${((s.endMs - s.startMs) / total) * 100}%)`,
                        background: SPAN_COLOR[s.kind],
                      }}
                    >
                      {s.kind !== 'lock' && label}
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
      <div className="ml-38 mt-1 flex justify-between pl-[152px] font-mono text-[10px] text-muted-foreground">
        <span>0</span>
        <span>
          {fmt(total / 2)} {t('units.ms')}
        </span>
        <span>
          {fmt(total)} {t('units.ms')}
        </span>
      </div>
    </div>
  );
}
