import { t } from '@/i18n';
import type { Issue } from '@/schema/validate';

export function issueText(issue: Issue): string {
  return t(`issues.${issue.code}`, issue.params);
}
