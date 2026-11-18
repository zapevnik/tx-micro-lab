/** Создание проектов из шаблонов и импорт JSON с понятными ошибками (5.15). */
import { navigate } from '@/app/router';
import { getEngine } from '@/engine';
import { t } from '@/i18n';
import { pickTextFile } from '@/lib/utils';
import { parseProject } from '@/schema/io';
import { emptySchema, type Schema } from '@/schema/types';
import { ui } from '@/store/ui';
import { newProjectId, projectsRepo } from './storage';

export async function createProject(schema: Schema): Promise<string> {
  const id = newProjectId();
  await projectsRepo.put({ id, name: schema.meta.name, updatedAt: Date.now(), schema });
  return id;
}

export async function createFromTemplate(templateId: string | null) {
  const schema = templateId ? await getEngine().getTemplate(templateId) : emptySchema(t('start.defaultName'));
  if (templateId) schema.meta.name = t(`templates.${templateId as 'eshop'}.name`);
  navigate({ screen: 'editor', projectId: await createProject(schema) });
}

export async function importProjectFile() {
  const text = await pickTextFile();
  if (text === null) return;
  const r = parseProject(text);
  if (!r.ok) {
    ui().toast(t(`io.errors.${r.reason}`, { version: r.version ?? '', details: r.details ?? '' }), 'error');
    return;
  }
  const id = await createProject(r.schema);
  ui().toast(t('io.imported', { name: r.schema.meta.name }), 'success');
  navigate({ screen: 'editor', projectId: id });
}
