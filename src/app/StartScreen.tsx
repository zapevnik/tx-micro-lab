/** Стартовый экран (раздел 4): список проектов, шаблоны, импорт JSON. */
import { Building2, FilePlus2, FolderOpen, Landmark, Plane, ShoppingCart, Trash2, Upload, Workflow } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { createFromTemplate, importProjectFile } from '@/features/projects/projectIo';
import { projectsRepo, type ProjectRecord } from '@/features/projects/storage';
import { TEMPLATES } from '@/features/projects/templates';
import { fmtDate, t } from '@/i18n';
import { ui } from '@/store/ui';
import { navigate } from './router';

const TEMPLATE_ICON: Record<string, typeof Building2> = { eshop: ShoppingCart, bank: Landmark, travel: Plane };

export function StartScreen() {
  const [projects, setProjects] = useState<ProjectRecord[] | null>(null);
  const reload = () => projectsRepo.list().then(setProjects, () => setProjects([]));
  useEffect(() => {
    reload();
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Workflow className="size-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{t('app.title')}</h1>
            <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{t('start.subtitle')}</p>
          </div>
        </div>

        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('start.templates')}</h2>
        <div className="mb-10 grid grid-cols-4 gap-3">
          <TemplateCard icon={FilePlus2} title={t('start.newProject')} description="" onClick={() => createFromTemplate(null)} testId="new-empty" />
          {TEMPLATES.map((tp) => (
            <TemplateCard
              key={tp.id}
              icon={TEMPLATE_ICON[tp.id] ?? Building2}
              title={t(`templates.${tp.id}.name`)}
              description={t(`templates.${tp.id}.description`)}
              onClick={() => createFromTemplate(tp.id)}
              testId={`template-${tp.id}`}
            />
          ))}
        </div>

        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('start.projects')}</h2>
          <Button variant="secondary" size="sm" onClick={() => importProjectFile()}>
            <Upload /> {t('start.import')}
          </Button>
        </div>
        {projects && projects.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t('start.noProjects')}</div>
        )}
        <div className="grid grid-cols-3 gap-3">
          {projects?.map((p) => (
            <div
              key={p.id}
              className="group cursor-pointer rounded-lg border border-border bg-card/60 p-4 transition-colors hover:border-primary/60"
              onClick={() => navigate({ screen: 'editor', projectId: p.id })}
              data-testid="project-card"
            >
              <div className="flex items-start gap-2">
                <FolderOpen className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t('start.updated', { date: fmtDate(p.updatedAt) })} · {t('start.nodes', { n: p.schema.nodes.length })}
                  </div>
                </div>
                <button
                  className="cursor-pointer rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    ui().askConfirm({ text: t('start.deleteConfirm', { name: p.name }), onConfirm: () => projectsRepo.remove(p.id).then(reload) });
                  }}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TemplateCard({ icon: Icon, title, description, onClick, testId }: { icon: typeof Building2; title: string; description: string; onClick: () => void; testId: string }) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className="flex cursor-pointer flex-col items-start gap-2 rounded-lg border border-border bg-card/60 p-4 text-left transition-colors hover:border-primary/60 hover:bg-accent/40"
    >
      <Icon className="size-5 text-primary" />
      <div className="font-medium">{title}</div>
      {description && <div className="text-xs leading-snug text-muted-foreground">{description}</div>}
    </button>
  );
}
