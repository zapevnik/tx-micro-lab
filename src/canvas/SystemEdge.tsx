/**
 * Связь: толщина пропорциональна трафику (5.9), пунктир у репликации с текущим отставанием (5.4),
 * отметки наложенных отказов связи (5.10).
 */
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import { Scissors } from 'lucide-react';
import { memo } from 'react';
import { fmt, t } from '@/i18n';
import { useProject } from '@/store/project';
import { useSim } from '@/store/sim';
import { edgeWidth } from './geometry';
import { getHighlight } from './highlight';

function SystemEdgeImpl(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected } = props;
  const edge = useProject((s) => s.schema.edges.find((e) => e.id === id));
  const hl = useProject((s) => getHighlight(s.schema, s.highlightEndpoint));
  const metrics = useSim((s) => s.edges[id]);
  const running = useSim((s) => s.status !== 'idle');
  const faults = useSim((s) => s.faults);
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  if (!edge) return null;

  const rps = running ? (metrics?.rps ?? 0) : 0;
  const errFrac = metrics && metrics.rps > 0 ? metrics.errorsPerS / metrics.rps : 0;
  const myFaults = Object.values(faults).filter((f) => 'edgeId' in f.action && f.action.edgeId === id);
  const partition = myFaults.some((f) => f.action.type === 'linkPartition');
  const inTx = hl && hl.participants.has(edge.source) && (hl.participants.has(edge.target) || hl.coordinator === edge.target);
  const isRepl = edge.kind === 'replication';
  const isInternal = edge.kind !== 'call';

  let stroke = '#3b4b6b';
  if (inTx) stroke = '#a78bfa';
  if (running && rps > 0) stroke = errFrac > 0.2 ? '#f43f5e' : '#4b6390';
  if (isInternal && !inTx) stroke = '#7c5f2a';
  if (partition) stroke = '#f43f5e';

  const faultLabels: string[] = [];
  for (const f of myFaults) {
    const a = f.action;
    if (a.type === 'linkDelay') faultLabels.push(`+${fmt(a.delayMs)} ${t('units.ms')}`);
    if (a.type === 'linkLoss') faultLabels.push(`${t('chaos.types.linkLoss')} ${fmt(a.pct)}%`);
    if (a.type === 'linkDuplicate') faultLabels.push(`${t('chaos.types.linkDuplicate')} ${fmt(a.pct)}%`);
  }
  if (edge.network.latencyMs > 20 && !isInternal) faultLabels.push(`${fmt(edge.network.latencyMs)} ${t('units.ms')}`);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className="edge-main"
        style={{
          stroke,
          strokeWidth: edgeWidth(rps) + (selected ? 1 : 0),
          strokeDasharray: isRepl || partition ? '6 5' : undefined,
          opacity: isInternal ? 0.85 : 1,
          transition: 'stroke-width 0.3s, stroke 0.3s',
        }}
      />
      {isRepl && running && <path d={path} fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 12" className="edge-replication" />}
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {partition && (
            <span className="flex items-center gap-1 rounded bg-red-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              <Scissors className="size-3" /> partition
            </span>
          )}
          {faultLabels.map((l) => (
            <span key={l} className="rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-amber-950">
              {l}
            </span>
          ))}
          {isRepl && running && metrics?.lagMs !== undefined && (
            <span className="rounded bg-slate-900/90 px-1.5 py-0.5 font-mono text-[10px] text-amber-300 ring-1 ring-amber-500/40">
              {t('badges.lag')} {fmt(metrics.lagMs)} {t('units.ms')}
            </span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const SystemEdge = memo(SystemEdgeImpl);
