/** Верхняя панель (раздел 4, 5.8): проект · Старт / Пауза / Стоп / Сброс · скорость · время · seed · Сравнить · Экспорт. */
import {
  BarChart3,
  ChevronLeft,
  Download,
  FileJson,
  FileSpreadsheet,
  Lightbulb,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Sparkles,
  Square,
  Undo2,
  Upload,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Select,
  Tip,
} from '@/components/ui';
import { getEngine } from '@/engine';
import { importProjectFile } from '@/features/projects/projectIo';
import { pause, resetRun, resume, setSpeed, start, stop } from '@/features/sim/controller';
import { fmtTime, t } from '@/i18n';
import { cn, downloadText, safeFilename, toCsv } from '@/lib/utils';
import { serializeProject } from '@/schema/io';
import { project, useProject } from '@/store/project';
import { sim, useSim } from '@/store/sim';
import { useUi } from '@/store/ui';
import { navigate } from './router';

const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100];

export function TopBar({ saved }: { saved: boolean }) {
  const name = useProject((s) => s.schema.meta.name);
  const projectId = useProject((s) => s.projectId);
  const seed = useProject((s) => s.schema.seed);
  const errors = useProject((s) => s.issues.filter((i) => i.severity === 'error').length);
  const canUndo = useProject((s) => s.past.length > 0);
  const canRedo = useProject((s) => s.future.length > 0);
  const status = useSim((s) => s.status);
  const time = useSim((s) => s.t);
  const speed = useSim((s) => s.speed);
  const connection = useSim((s) => s.connection);
  const { animation, hints, setPrefs } = useUi();
  const engineKind = getEngine().kind;

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card/60 px-2">
      <Tip content={t('topbar.home')}>
        <Button variant="ghost" size="icon" onClick={() => navigate({ screen: 'start' })}>
          <ChevronLeft />
        </Button>
      </Tip>
      <div className="flex min-w-0 max-w-64 flex-col leading-tight">
        <span className="truncate text-sm font-semibold" data-testid="project-name">
          {name}
        </span>
        <span className="text-[10.5px] text-muted-foreground">{saved ? `✓ ${t('topbar.saved')}` : '…'}</span>
      </div>

      <div className="ml-2 flex items-center gap-0.5">
        <Tip content={t('topbar.undo')}>
          <Button variant="ghost" size="iconSm" disabled={!canUndo} onClick={() => project().undo()} data-testid="undo">
            <Undo2 />
          </Button>
        </Tip>
        <Tip content={t('topbar.redo')}>
          <Button variant="ghost" size="iconSm" disabled={!canRedo} onClick={() => project().redo()}>
            <Redo2 />
          </Button>
        </Tip>
      </div>

      <div className="mx-2 h-6 w-px bg-border" />

      {/* Управление запуском */}
      <div className="flex items-center gap-1">
        {status === 'running' ? (
          <Button variant="warn" size="sm" onClick={pause} data-testid="btn-pause">
            <Pause /> {t('topbar.pause')}
          </Button>
        ) : (
          <Tip content={errors > 0 ? t('topbar.cannotStart', { n: errors }) : t('topbar.hotkeys')}>
            <span>
              <Button
                variant="success"
                size="sm"
                disabled={errors > 0 && status === 'idle'}
                onClick={status === 'paused' ? resume : start}
                data-testid="btn-start"
              >
                <Play /> {status === 'paused' ? t('topbar.resume') : t('topbar.start')}
              </Button>
            </span>
          </Tip>
        )}
        <Button variant="secondary" size="sm" disabled={status === 'idle'} onClick={stop} data-testid="btn-stop">
          <Square /> {t('topbar.stop')}
        </Button>
        <Tip content={t('topbar.reset')}>
          <Button variant="ghost" size="iconSm" onClick={resetRun}>
            <RotateCcw />
          </Button>
        </Tip>
      </div>

      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">{t('topbar.speed')}</span>
        <Select className="h-7 w-20 text-xs" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} data-testid="speed">
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              ×{String(s).replace('.', ',')}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex items-center gap-3 rounded-md border border-border bg-background/60 px-2.5 py-1 font-mono text-xs">
        <span>
          <span className="font-sans text-muted-foreground">{t('topbar.time')} </span>
          <span data-testid="virtual-time">{fmtTime(time)}</span>
        </span>
        <span>
          <span className="font-sans text-muted-foreground">{t('topbar.seed')} </span>
          {seed}
        </span>
        <span className={cn('font-sans', status === 'running' ? 'text-emerald-400' : status === 'paused' ? 'text-amber-400' : 'text-muted-foreground')}>
          ● {t(`topbar.status.${status}`)}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Tip content={`${t(`topbar.engine.${engineKind}`)}: ${t(`topbar.connection.${connection}`)}`}>
          <span className={cn('mr-1 flex items-center gap-1 text-[11px]', connection === 'open' ? 'text-muted-foreground' : 'text-red-400')}>
            {connection === 'open' ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
            {t(`topbar.engine.${engineKind}`)}
          </span>
        </Tip>
        <Tip content={t('topbar.animation')}>
          <Button variant={animation ? 'secondary' : 'ghost'} size="iconSm" onClick={() => setPrefs({ animation: !animation })} data-testid="toggle-animation">
            <Sparkles className={animation ? 'text-sky-400' : ''} />
          </Button>
        </Tip>
        <Tip content={t('topbar.hints')}>
          <Button variant={hints ? 'secondary' : 'ghost'} size="iconSm" onClick={() => setPrefs({ hints: !hints })}>
            <Lightbulb className={hints ? 'text-amber-400' : ''} />
          </Button>
        </Tip>
        <div className="mx-1 h-6 w-px bg-border" />
        <Button variant="secondary" size="sm" onClick={() => projectId && navigate({ screen: 'compare', projectId })} data-testid="btn-compare">
          <BarChart3 /> {t('topbar.compare')}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" data-testid="btn-export">
              <Download /> {t('topbar.export')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={exportJson} data-testid="export-json">
              <FileJson /> {t('topbar.exportJson')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={exportCsv} disabled={!sim().fullHistory.length}>
              <FileSpreadsheet /> {t('topbar.exportCsv')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => importProjectFile()}>
              <Upload /> {t('topbar.importJson')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function exportJson() {
  const s = project().schema;
  downloadText(`${safeFilename(s.meta.name)}.json`, serializeProject(s));
}

/** Экспорт данных запуска в CSV (5.12). */
function exportCsv() {
  const s = project().schema;
  const rows: (string | number)[][] = [
    ['t, s', 'throughput', 'p50, ms', 'p95, ms', 'p99, ms', 'errors/s', 'committed/s', 'rolledBack/s', 'compensated/s', 'stuck/s', 'failed/s', 'violations total', 'messages/tx'],
    ...sim().fullHistory.map((p) => [
      p.t,
      p.throughput,
      p.p50,
      p.p95,
      p.p99,
      p.errorsPerS,
      p.committed,
      p.rolledBack,
      p.compensated,
      p.stuck,
      p.failed,
      p.violationsTotal,
      p.messagesPerTx,
    ]),
  ];
  downloadText(`${safeFilename(s.meta.name)}-run.csv`, toCsv(rows), 'text/csv');
}
