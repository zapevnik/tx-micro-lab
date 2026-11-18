/** Нижняя панель (раздел 4): «Метрики», «Трассировка», «Журнал событий», «Задания». */
import { Activity, AlertTriangle, CheckCircle2, ClipboardList, GitBranch, Info, ListChecks, ScrollText, ShieldAlert, Trash2, Zap } from 'lucide-react';
import { Button, Empty, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';
import { GlobalCharts } from '@/features/metrics/MetricsCharts';
import { TasksPanel } from '@/features/tasks/Tasks';
import { TracingPanel } from '@/features/tracing/TracingPanel';
import { fmt, t } from '@/i18n';
import { cn } from '@/lib/utils';
import { project } from '@/store/project';
import { useSim, type LogKind } from '@/store/sim';
import { useUi, type BottomTab } from '@/store/ui';

export function BottomPanel() {
  const tab = useUi((s) => s.bottomTab);
  const setTab = useUi((s) => s.setBottomTab);
  const logCount = useSim((s) => s.log.length);
  const violations = useSim((s) => s.violationsTotal);
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as BottomTab)} className="flex h-full flex-col bg-card/30">
      <TabsList>
        <TabsTrigger value="metrics" data-testid="tab-metrics">
          <Activity /> {t('bottom.tabs.metrics')}
        </TabsTrigger>
        <TabsTrigger value="tracing" data-testid="tab-tracing">
          <GitBranch /> {t('bottom.tabs.tracing')}
        </TabsTrigger>
        <TabsTrigger value="log" data-testid="tab-log">
          <ScrollText /> {t('bottom.tabs.log')}
          {logCount > 0 && <span className="rounded bg-muted px-1 text-[10px]">{logCount}</span>}
        </TabsTrigger>
        <TabsTrigger value="tasks">
          <ListChecks /> {t('bottom.tabs.tasks')}
        </TabsTrigger>
        {violations > 0 && (
          <span className="ml-auto flex items-center gap-1 rounded bg-fuchsia-500/15 px-2 py-0.5 text-[11px] font-medium text-fuchsia-300" data-testid="violations-counter">
            <ShieldAlert className="size-3.5" /> {t('charts.series.violations')}: {fmt(violations)}
          </span>
        )}
      </TabsList>
      <TabsContent value="metrics" className="min-h-0 flex-1">
        <GlobalCharts />
      </TabsContent>
      <TabsContent value="tracing" className="min-h-0 flex-1">
        <TracingPanel />
      </TabsContent>
      <TabsContent value="log" className="min-h-0 flex-1">
        <LogPanel />
      </TabsContent>
      <TabsContent value="tasks" className="min-h-0 flex-1">
        <TasksPanel />
      </TabsContent>
    </Tabs>
  );
}

const LOG_ICON: Record<LogKind, { icon: typeof Info; cls: string }> = {
  alert: { icon: AlertTriangle, cls: 'text-amber-400' },
  resolved: { icon: CheckCircle2, cls: 'text-emerald-400' },
  violation: { icon: ShieldAlert, cls: 'text-fuchsia-400' },
  change: { icon: ClipboardList, cls: 'text-sky-400' },
  run: { icon: Info, cls: 'text-muted-foreground' },
  fault: { icon: Zap, cls: 'text-red-400' },
  error: { icon: AlertTriangle, cls: 'text-red-400' },
};

function LogPanel() {
  const log = useSim((s) => s.log);
  const clear = useSim((s) => s.clearLog);
  if (!log.length) return <Empty>{t('log.empty')}</Empty>;
  return (
    <div className="flex h-full flex-col">
      <div className="flex justify-end border-b border-border px-2 py-1">
        <Button size="xs" variant="ghost" onClick={clear}>
          <Trash2 /> {t('log.clear')}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto font-mono text-[11.5px]" data-testid="event-log">
        {log.map((e) => {
          const { icon: Icon, cls } = LOG_ICON[e.kind];
          return (
            <div
              key={e.id}
              className={cn('flex cursor-default items-center gap-2 border-b border-border/40 px-3 py-0.5 hover:bg-accent/50', e.nodeId && 'cursor-pointer')}
              onClick={() => e.nodeId && project().select({ nodes: [e.nodeId], edges: [] })}
            >
              <span className="w-14 shrink-0 text-muted-foreground">{fmt(e.t, 1)}с</span>
              <Icon className={cn('size-3.5 shrink-0', cls)} />
              <span className={cn('w-24 shrink-0', cls)}>{t(`log.kinds.${e.kind}`)}</span>
              <span className="truncate font-sans">{e.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
