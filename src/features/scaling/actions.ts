/** Применение масштабирования к текущему проекту с предупреждением о кросс-шардовых транзакциях. */
import { t } from '@/i18n';
import { endpointsWritingTo, txNeedsDistributedPattern } from '@/schema/analysis';
import type { PartitioningConfig, ReplicationConfig, ShardingConfig } from '@/schema/types';
import { project } from '@/store/project';
import { ui } from '@/store/ui';
import {
  partitionDatabase,
  replicateDatabase,
  shardDatabase,
  unpartitionDatabase,
  unreplicateDatabase,
  unshardDatabase,
} from './scaling';

export function applyShard(dbId: string, cfg: ShardingConfig) {
  const before = project().schema;
  const wasDistributed = new Set(
    before.endpoints.filter((ep) => txNeedsDistributedPattern(before, ep)).map((ep) => ep.id),
  );
  project().apply((s) => shardDatabase(unreplicateDatabase(s, dbId), dbId, cfg));
  const after = project().schema;
  const affected = endpointsWritingTo(after, dbId)
    .filter((ep) => txNeedsDistributedPattern(after, ep) && !wasDistributed.has(ep.id))
    .map((ep) => ep.id);
  ui().toast(t('scaling.applied'), 'success');
  if (affected.length) ui().setShardWarning({ dbId, endpointIds: affected });
}

export function removeShard(dbId: string) {
  project().apply((s) => unshardDatabase(s, dbId));
}

export function applyReplicate(dbId: string, cfg: ReplicationConfig) {
  project().apply((s) => replicateDatabase(s, dbId, cfg));
  ui().toast(t('scaling.applied'), 'success');
}

export function removeReplicate(dbId: string) {
  project().apply((s) => unreplicateDatabase(s, dbId));
}

export function applyPartition(dbId: string, cfg: PartitioningConfig) {
  project().apply((s) => partitionDatabase(s, dbId, cfg));
  ui().toast(t('scaling.applied'), 'success');
}

export function removePartition(dbId: string) {
  project().apply((s) => unpartitionDatabase(s, dbId));
}
