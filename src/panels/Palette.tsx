/** Палитра элементов (раздел 4): перетаскивание на холст. */
import { DND_MIME } from '@/canvas/Canvas';
import { KIND_COLOR, KIND_ICON } from '@/canvas/icons';
import { t } from '@/i18n';
import type { NodeKind } from '@/schema/types';

const GROUPS: NodeKind[][] = [['client', 'gateway', 'balancer'], ['service'], ['database', 'cache', 'broker']];

export function Palette() {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="px-3 pb-1 pt-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('palette.title')}</div>
        <div className="text-[11px] text-muted-foreground/80">{t('palette.hint')}</div>
      </div>
      {GROUPS.map((g, i) => (
        <div key={i} className="space-y-1 border-b border-border px-2 py-2 last:border-0">
          {g.map((kind) => {
            const Icon = KIND_ICON[kind];
            return (
              <div
                key={kind}
                draggable
                data-testid={`palette-${kind}`}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DND_MIME, kind);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                className="group flex cursor-grab items-center gap-2.5 rounded-md border border-transparent px-2 py-1.5 transition-colors hover:border-border hover:bg-accent active:cursor-grabbing"
              >
                <div
                  className="flex size-8 shrink-0 items-center justify-center rounded-md"
                  style={{ background: `${KIND_COLOR[kind]}1f`, color: KIND_COLOR[kind] }}
                >
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium leading-tight">{t(`kinds.${kind}`)}</div>
                  <div className="truncate text-[10.5px] leading-tight text-muted-foreground">{t(`kindHints.${kind}`)}</div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
