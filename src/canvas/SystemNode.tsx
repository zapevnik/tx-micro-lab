/**
 * Узел холста. Показывает (5.9): цвет по загрузке, бейджи RPS / p99 / очередь, у БД — блокировки,
 * у реплики — отставание, у брокера — непрочитанные; состояние дублируется значком с числом (ТЗ 7,
 * доступность). Ошибки схемы — значок прямо на узле (5.1). У клиента — ползунок RPS (5.7).
 */
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertCircle, AlertTriangle, CheckCircle2, Crown, Flame, Lightbulb, PowerOff, Snail } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import type { AlertMsg, NodeMetrics } from '@/engine/types';
import { setClientRps } from '@/features/sim/controller';
import { fmt, fmtCompact, t, tMaybe } from '@/i18n';
import { cn } from '@/lib/utils';
import { numParam } from '@/schema/params';
import { updateNode } from '@/schema/ops';
import { Slider, Tip } from '@/components/ui';
import { issueText } from '@/panels/issueText';
import { useProject } from '@/store/project';
import { alertKey, useSim } from '@/store/sim';
import { loadLevel, useUi } from '@/store/ui';
import { getHighlight } from './highlight';
import { KIND_COLOR, nodeIcon } from './icons';
import { NodeHint } from './NodeHint';
import { visibleAlertKeys } from '@/features/hints/visible';

const HIDDEN = { opacity: 0, pointerEvents: 'none' } as const;

function SystemNodeImpl({ id }: NodeProps) {
  const node = useProject((s) => s.schema.nodes.find((n) => n.id === id));
  const schema = useProject((s) => s.schema);
  const issues = useProject((s) => s.issues);
  const highlightEp = useProject((s) => s.highlightEndpoint);
  const apply = useProject((s) => s.apply);
  const m = useSim((s) => s.nodes[id]) as NodeMetrics | undefined;
  const queueTrend = useSim((s) => {
    const h = s.nodeHistory[id];
    return h && h.length > 3 ? h[h.length - 1].queue - h[h.length - 4].queue : 0;
  });
  const status = useSim((s) => s.status);
  const alerts = useSim((s) => s.alerts);
  const dismissed = useSim((s) => s.dismissed);
  const faults = useSim((s) => s.faults);
  const { warnAt, critAt, hints } = useUi();
  const [editing, setEditing] = useState(false);

  const myIssues = useMemo(() => issues.filter((i) => i.nodeId === id), [issues, id]);
  const myFaults = useMemo(
    () => Object.values(faults).filter((f) => 'nodeId' in f.action && f.action.nodeId === id),
    [faults, id],
  );
  const hint = useMemo<AlertMsg | null>(() => {
    if (!hints) return null;
    const visible = visibleAlertKeys(alerts, dismissed);
    return Object.values(alerts).find((a) => a.nodeId === id && visible.has(alertKey(a))) ?? null;
  }, [alerts, dismissed, hints, id]);
  // Остальные активные проблемы узла — значком с текстом во всплывающей подсказке.
  const otherAlerts = useMemo(
    () => (hints ? Object.values(alerts).filter((a) => a.nodeId === id && a !== hint && !dismissed[alertKey(a)]) : []),
    [alerts, dismissed, hints, id, hint],
  );
  const hintBelow = useProject((s) => {
    const n = s.schema.nodes.find((x) => x.id === id);
    return !!n && s.schema.nodes.some((x) => x.groupId === id && x.position.y < n.position.y);
  });

  if (!node) return null;
  const hl = getHighlight(schema, highlightEp);
  const isCoordinator = hl?.coordinator === id;
  const isParticipant = hl?.participants.has(id) ?? false;
  const Icon = nodeIcon(node);
  const running = status !== 'idle' && !!m;
  const down = m?.down || myFaults.some((f) => f.action.type === 'nodeDown');
  const slow = myFaults.find((f) => f.action.type === 'nodeSlow');
  const level = running && !down ? loadLevel(m!.load, m!.queue > 20 && queueTrend > 5, warnAt, critAt) : null;
  const errors = myIssues.filter((i) => i.severity === 'error');
  const sharding = node.scaling?.sharding;
  const replication = node.scaling?.replication;
  const partitioning = node.scaling?.partitioning;
  const kindLabel = sharding
    ? t('kinds.router')
    : node.role === 'shard'
      ? t('kinds.shard')
      : node.role === 'replica'
        ? t('kinds.replica')
        : t(`kinds.${node.kind}`);
  const isDb = node.kind === 'database';
  const derived = !!node.role;
  const workload = node.kind === 'client' ? schema.workload.find((w) => w.clientId === id) : undefined;

  const borderColor = down
    ? 'var(--down)'
    : level
      ? `var(--${level})`
      : isCoordinator
        ? '#f59e0b'
        : isParticipant
          ? '#a78bfa'
          : 'var(--node-border)';

  const LevelIcon = level === 'crit' ? Flame : level === 'warn' ? AlertTriangle : CheckCircle2;

  return (
    <>
      {hint && <NodeHint alert={hint} below={hintBelow} />}
      <div
        data-testid={`node-${node.name}`}
        className={cn(
          'relative rounded-lg border-2 bg-node shadow-lg transition-[border-color,opacity] duration-300',
          derived ? 'w-[170px]' : 'w-[200px]',
          down && 'opacity-60 grayscale',
          level === 'crit' && 'node-crit',
          (isParticipant || isCoordinator) && !level && 'shadow-[0_0_0_4px_rgba(167,139,250,0.18)]',
        )}
        style={{ borderColor }}
      >
        {/* Маркеры связей */}
        {node.kind !== 'client' && <Handle type="target" position={Position.Left} id="in" isConnectable={!derived} />}
        {!['database', 'cache'].includes(node.kind) && <Handle type="source" position={Position.Right} id="out" />}
        {/* Служебные маркеры для связей шардов и реплик — невидимые, выбираются по расположению узлов */}
        {isDb && (
          <>
            <Handle type="source" position={Position.Bottom} id="down" isConnectable={false} style={HIDDEN} />
            <Handle type="source" position={Position.Top} id="upout" isConnectable={false} style={HIDDEN} />
            <Handle type="source" position={Position.Right} id="side" isConnectable={false} style={HIDDEN} />
            <Handle type="source" position={Position.Left} id="leftout" isConnectable={false} style={HIDDEN} />
          </>
        )}
        {derived && (
          <>
            <Handle type="target" position={Position.Top} id="up" isConnectable={false} style={HIDDEN} />
            <Handle type="target" position={Position.Bottom} id="downin" isConnectable={false} style={HIDDEN} />
            <Handle type="target" position={Position.Right} id="rightin" isConnectable={false} style={HIDDEN} />
          </>
        )}

        <div className="flex items-center gap-2 px-2.5 pb-1.5 pt-2">
          <div
            className="relative flex size-7 shrink-0 items-center justify-center rounded-md"
            style={{ background: `${KIND_COLOR[node.kind]}22`, color: KIND_COLOR[node.kind] }}
          >
            <Icon className="size-4" />
            {down && <PowerOff className="absolute -bottom-1 -right-1 size-3.5 rounded-full bg-node text-slate-300" />}
          </div>
          <div className="min-w-0 flex-1">
            {editing ? (
              <input
                autoFocus
                defaultValue={node.name}
                className="nodrag w-full rounded border border-ring bg-background px-1 text-[13px] font-semibold outline-none"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== node.name) apply((s) => updateNode(s, id, { name: v }));
                  setEditing(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setEditing(false);
                  e.stopPropagation();
                }}
              />
            ) : (
              <div
                className={cn('truncate text-[13px] font-semibold leading-tight', down && 'line-through')}
                onDoubleClick={() => !derived && setEditing(true)}
              >
                {node.name}
              </div>
            )}
            <div className="truncate text-[10.5px] uppercase tracking-wide text-muted-foreground">
              {kindLabel}
              {node.kind === 'service' && ` · ×${numParam(node.params, 'service', 'instances')}`}
            </div>
          </div>
          {errors.length > 0 && (
            <Tip content={<ul className="list-disc pl-3">{errors.map((e, i) => <li key={i}>{issueText(e)}</li>)}</ul>}>
              <AlertCircle className="size-4 shrink-0 text-red-400" data-testid="node-error" />
            </Tip>
          )}
          {otherAlerts.length > 0 && (
            <Tip content={<ul className="space-y-1">{otherAlerts.map((a) => <li key={a.code}>{tMaybe(`alerts.${a.code}.title`, a.params)}</li>)}</ul>}>
              <Lightbulb className="size-4 shrink-0 cursor-help text-amber-400" data-testid="node-alert-icon" />
            </Tip>
          )}
          {isCoordinator && (
            <Tip content={t('badges.coordinator')}>
              <Crown className="size-4 shrink-0 text-amber-400" />
            </Tip>
          )}
          {slow && (
            <Tip content={t('chaos.slow')}>
              <Snail className="size-4 shrink-0 text-amber-300" />
            </Tip>
          )}
        </div>

        {/* Масштабирование */}
        {(sharding || replication || partitioning) && (
          <div className="flex flex-wrap gap-1 px-2.5 pb-1.5">
            {sharding && <Chip>{t('canvas.sharded', { n: sharding.count, strategy: sharding.strategy })}</Chip>}
            {replication && (
              <Chip>{t('canvas.replicated', { n: replication.count, mode: t(`scaling.replicate.${replication.mode}`) })}</Chip>
            )}
          </div>
        )}
        {partitioning && (
          <div className="px-2.5 pb-1.5">
            <div className="mb-0.5 text-[10px] text-muted-foreground">
              {partitioning.table} · {t('canvas.partitioned', { n: partitioning.count })}
            </div>
            <div className="flex h-2 gap-px overflow-hidden rounded-sm">
              {Array.from({ length: Math.min(partitioning.count, 24) }, (_, i) => (
                <div key={i} className="flex-1 bg-amber-500/50" />
              ))}
            </div>
          </div>
        )}

        {/* Нагрузка клиента */}
        {node.kind === 'client' && workload && (
          <div className="nodrag px-2.5 pb-2">
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>{t('load.rps')}</span>
              <span className="font-mono text-foreground">{fmt(workload.rps)}</span>
            </div>
            <Slider
              min={0}
              max={Math.max(3000, workload.rps)}
              step={10}
              value={workload.rps}
              onChange={(e) => setClientRps(id, Number(e.target.value), false)}
              onPointerUp={(e) => setClientRps(id, Number((e.target as HTMLInputElement).value), true)}
              onKeyUp={(e) => setClientRps(id, Number((e.target as HTMLInputElement).value), true)}
              aria-label={t('load.rps')}
            />
          </div>
        )}

        {/* Метрики во время запуска */}
        {running && node.kind !== 'client' && (
          <div className="border-t border-border/70 px-2.5 py-1.5">
            {!down && (
              <div className="mb-1 flex items-center gap-1.5">
                <LevelIcon className="size-3.5 shrink-0" style={{ color: `var(--${level})` }} />
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-[width] duration-200"
                    style={{ width: `${Math.min(100, m!.load * 100)}%`, background: `var(--${level})` }}
                  />
                </div>
                <span className="w-9 text-right font-mono text-[11px]">{fmt(Math.min(999, m!.load * 100), 0)}%</span>
              </div>
            )}
            {down ? (
              <div className="text-[11px] font-medium text-slate-400">{t('badges.down')}</div>
            ) : (
              <div className="flex flex-wrap gap-1">
                <Metric label={t('badges.rps')} value={fmtCompact(m!.rps)} />
                <Metric label={t('badges.p99')} value={`${fmt(m!.p99)}`} unit={t('units.ms')} hot={m!.p99 > 300} />
                {m!.queue > 0 && node.kind !== 'broker' && <Metric label={t('badges.queue')} value={fmtCompact(m!.queue)} hot={m!.queue > 50} />}
                {isDb && (m!.locks ?? 0) > 0 && <Metric label={t('badges.locks')} value={fmtCompact(m!.locks ?? 0)} hot={(m!.locks ?? 0) > 50} />}
                {m!.lagMs !== undefined && <Metric label={t('badges.lag')} value={fmt(m!.lagMs)} unit={t('units.ms')} hot={m!.lagMs > 500} />}
                {m!.backlog !== undefined && m!.backlog > 0 && <Metric label={t('badges.backlog')} value={fmtCompact(m!.backlog)} hot={m!.backlog > 500} />}
                {m!.errorsPerS > 0.5 && <Metric label={t('badges.errors')} value={fmtCompact(m!.errorsPerS)} hot />}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-300">{children}</span>;
}

function Metric({ label, value, unit, hot }: { label: string; value: string; unit?: string; hot?: boolean }) {
  return (
    <span className={cn('rounded bg-muted px-1.5 py-0.5 text-[10.5px] leading-none', hot && 'bg-red-500/15 text-red-300')}>
      <span className="text-muted-foreground">{label}</span> <span className="font-mono font-medium">{value}</span>
      {unit && <span className="text-muted-foreground"> {unit}</span>}
    </span>
  );
}

export const SystemNode = memo(SystemNodeImpl);
