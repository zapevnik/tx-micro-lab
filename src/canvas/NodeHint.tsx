/** Подсказка рядом с проблемным узлом (5.14): что происходит, почему и кнопки действий. */
import { NodeToolbar, Position } from '@xyflow/react';
import { Lightbulb, X } from 'lucide-react';
import type { AlertMsg } from '@/engine/types';
import { hintActions, runHintAction } from '@/features/hints/actions';
import { t, tMaybe } from '@/i18n';
import { Button } from '@/components/ui';
import { alertKey, useSim } from '@/store/sim';

/** below — показать под узлом (если над ним стоят шарды). */
export function NodeHint({ alert, below }: { alert: AlertMsg; below?: boolean }) {
  const dismiss = useSim((s) => s.dismissAlert);
  const actions = hintActions(alert);
  const severe = alert.code !== 'crossShardTx' && alert.code !== 'replicaLag';
  return (
    <NodeToolbar isVisible position={below ? Position.Bottom : Position.Top} offset={10}>
      <div
        className={`hint-in nodrag w-72 rounded-lg border bg-popover/95 p-3 shadow-2xl backdrop-blur ${severe ? 'border-red-500/60' : 'border-amber-500/60'}`}
        data-testid={`hint-${alert.code}`}
      >
        <div className="flex items-start gap-2">
          <Lightbulb className={`mt-0.5 size-4 shrink-0 ${severe ? 'text-red-400' : 'text-amber-400'}`} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold leading-snug">{tMaybe(`alerts.${alert.code}.title`, alert.params)}</div>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{tMaybe(`alerts.${alert.code}.body`, alert.params)}</div>
          </div>
          <button
            className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title={t('alerts.actions.dismiss')}
            onClick={() => dismiss(alertKey(alert))}
          >
            <X className="size-3.5" />
          </button>
        </div>
        {actions.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5 pl-6">
            {actions.map((a, i) => (
              <Button key={a} size="sm" variant={i === 0 ? 'default' : 'secondary'} onClick={() => runHintAction(alert, a)}>
                {t(`alerts.actions.${a}`)}
              </Button>
            ))}
          </div>
        )}
      </div>
    </NodeToolbar>
  );
}
