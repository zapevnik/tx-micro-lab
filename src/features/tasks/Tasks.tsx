/**
 * Режим заданий (ТЗ 5.14): задание = стартовая схема + целевые условия, которые проверяются
 * на лету и показываются чек-листом. Проверка — чистая функция `evaluateTask`.
 */
import { CheckCircle2, Circle, PartyPopper, Target } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Empty, Input, Label } from '@/components/ui';
import { t } from '@/i18n';
import type { TaskGoals } from '@/schema/types';
import { project, useProject } from '@/store/project';
import { useSim, type GlobalPoint } from '@/store/sim';

export interface TaskCheck {
  key: 'minRps' | 'maxP99' | 'maxViolations';
  ok: boolean;
  value: number;
}

/** Сколько секунд подряд (с конца истории) выполняются все условия. */
export function evaluateTask(goals: TaskGoals, history: GlobalPoint[]): { checks: TaskCheck[]; heldS: number; done: boolean } {
  const last = history[history.length - 1];
  const checkPoint = (p: GlobalPoint) =>
    (goals.minRps === undefined || p.throughput >= goals.minRps) &&
    (goals.maxP99Ms === undefined || p.p99 < goals.maxP99Ms) &&
    (goals.maxViolations === undefined || p.violationsTotal <= goals.maxViolations);
  let heldS = 0;
  for (let i = history.length - 1; i > 0 && checkPoint(history[i]); i--) heldS = last.t - history[i - 1].t;
  const checks: TaskCheck[] = [];
  if (goals.minRps !== undefined) checks.push({ key: 'minRps', ok: !!last && last.throughput >= goals.minRps, value: goals.minRps });
  if (goals.maxP99Ms !== undefined) checks.push({ key: 'maxP99', ok: !!last && last.p99 < goals.maxP99Ms, value: goals.maxP99Ms });
  if (goals.maxViolations !== undefined)
    checks.push({ key: 'maxViolations', ok: !!last && last.violationsTotal <= goals.maxViolations, value: goals.maxViolations });
  return { checks, heldS, done: !!last && heldS >= goals.holdS };
}

export function TasksPanel() {
  const task = useProject((s) => s.schema.task);
  const history = useSim((s) => s.history);
  const [editing, setEditing] = useState(false);
  const result = useMemo(() => (task ? evaluateTask(task, history) : null), [task, history]);

  if (editing || !task) {
    if (!editing)
      return (
        <Empty>
          <Target className="mx-auto mb-2 size-6" />
          {t('tasks.none')}
          <div className="mt-3">
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              {t('tasks.create')}
            </Button>
          </div>
        </Empty>
      );
    return <TaskForm initial={task} onDone={() => setEditing(false)} />;
  }

  return (
    <div className="flex h-full gap-6 overflow-auto p-4" data-testid="tasks">
      <div className="min-w-72">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Target className="size-4 text-primary" /> {t('tasks.goals')}
        </div>
        <ul className="space-y-1.5">
          {result!.checks.map((c) => (
            <li key={c.key} className="flex items-center gap-2 text-[13px]">
              {c.ok ? <CheckCircle2 className="size-4 text-emerald-400" /> : <Circle className="size-4 text-muted-foreground" />}
              {t(`tasks.${c.key}`, { v: c.value })}
            </li>
          ))}
          <li className="flex items-center gap-2 text-[13px]">
            {result!.done ? <CheckCircle2 className="size-4 text-emerald-400" /> : <Circle className="size-4 text-muted-foreground" />}
            {t('tasks.hold', { v: task.holdS })}
          </li>
        </ul>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-emerald-500 transition-[width]" style={{ width: `${Math.min(100, (result!.heldS / task.holdS) * 100)}%` }} />
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">{t('tasks.progress', { s: Math.floor(result!.heldS), total: task.holdS })}</div>
        <div className="mt-3 flex gap-2">
          <Button size="xs" variant="secondary" onClick={() => setEditing(true)}>
            {t('tasks.edit')}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => project().apply((s) => ({ ...s, task: undefined }))}>
            {t('tasks.remove')}
          </Button>
        </div>
      </div>
      {result!.done && (
        <div className="flex items-center gap-3 self-start rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-emerald-300">
          <PartyPopper className="size-6" />
          <span className="font-semibold">{t('tasks.done')}</span>
        </div>
      )}
    </div>
  );
}

function TaskForm({ initial, onDone }: { initial?: TaskGoals; onDone: () => void }) {
  const [g, setG] = useState<TaskGoals>(initial ?? { minRps: 500, maxP99Ms: 300, maxViolations: 0, holdS: 30 });
  const num = (v: string) => (v.trim() === '' ? undefined : Math.max(0, Number(v) || 0));
  return (
    <div className="grid max-w-xl grid-cols-4 gap-3 p-4">
      <div className="space-y-1">
        <Label>{t('tasks.minRpsLabel')}</Label>
        <Input value={g.minRps ?? ''} onChange={(e) => setG({ ...g, minRps: num(e.target.value) })} />
      </div>
      <div className="space-y-1">
        <Label>{t('tasks.maxP99Label')}</Label>
        <Input value={g.maxP99Ms ?? ''} onChange={(e) => setG({ ...g, maxP99Ms: num(e.target.value) })} />
      </div>
      <div className="space-y-1">
        <Label>{t('tasks.maxViolationsLabel')}</Label>
        <Input value={g.maxViolations ?? ''} onChange={(e) => setG({ ...g, maxViolations: num(e.target.value) })} />
      </div>
      <div className="space-y-1">
        <Label>{t('tasks.holdLabel')}</Label>
        <Input value={g.holdS} onChange={(e) => setG({ ...g, holdS: Math.max(1, Number(e.target.value) || 1) })} />
      </div>
      <div className="col-span-4 flex gap-2">
        <Button
          size="sm"
          onClick={() => {
            project().apply((s) => ({ ...s, task: g }));
            onDone();
          }}
        >
          {t('common.save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}
