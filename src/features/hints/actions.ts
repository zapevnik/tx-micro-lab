/**
 * Подсказки (ТЗ 5.14): по коду alert — какие кнопки показать и что они делают.
 * Тексты подсказок живут на фронтенде (i18n `alerts.<code>`), движок присылает только код и параметры.
 */
import type { AlertMsg } from '@/engine/types';
import { t } from '@/i18n';
import { nodeById } from '@/schema/analysis';
import { numParam } from '@/schema/params';
import { setParam } from '@/schema/ops';
import { applyReplicate, applyShard } from '@/features/scaling/actions';
import { DEFAULT_REPLICATION, DEFAULT_SHARDING } from '@/features/scaling/scaling';
import { clearFaultsFor } from '@/features/sim/controller';
import { project } from '@/store/project';
import { ui } from '@/store/ui';

export type HintAction = 'shard' | 'replicate' | 'addInstance' | 'choosePattern' | 'makeIdempotent' | 'enable' | 'recover';

export function hintActions(alert: AlertMsg): HintAction[] {
  const node = nodeById(project().schema, alert.nodeId);
  switch (alert.code) {
    case 'dbOverload':
      if (node?.role === 'replica') return [];
      return node?.role === 'shard' ? ['replicate'] : ['shard', 'replicate'];
    case 'serviceOverload':
      return ['addInstance'];
    case 'brokerBacklog':
      return [];
    case 'coordinatorDown':
      return ['recover'];
    case 'crossShardTx':
      return ['choosePattern'];
    case 'duplicateDelivery':
      return ['makeIdempotent'];
    case 'nodeDown':
      return ['enable'];
    default:
      return [];
  }
}

export function runHintAction(alert: AlertMsg, action: HintAction) {
  const p = project();
  switch (action) {
    case 'shard':
      applyShard(alert.nodeId, DEFAULT_SHARDING);
      break;
    case 'replicate': {
      const cur = nodeById(p.schema, alert.nodeId)?.scaling?.replication;
      applyReplicate(alert.nodeId, cur ? { ...cur, count: Math.min(5, cur.count + 1) } : DEFAULT_REPLICATION);
      break;
    }
    case 'addInstance': {
      const node = nodeById(p.schema, alert.nodeId);
      if (!node) return;
      const n = numParam(node.params, 'service', 'instances');
      p.apply((s) => setParam(s, node.id, 'instances', Math.min(64, n + Math.max(1, Math.ceil(n / 2)))));
      ui().toast(t('alerts.applied', { what: t('alerts.actions.addInstance') }), 'success');
      break;
    }
    case 'choosePattern':
    case 'makeIdempotent': {
      const epId = String(alert.params.endpointId ?? '');
      const ep = p.schema.endpoints.find((e) => e.id === epId);
      if (!ep) return;
      if (action === 'makeIdempotent' && ep.transaction) {
        const tx = ep.transaction;
        p.apply((s) => ({
          ...s,
          endpoints: s.endpoints.map((e) =>
            e.id === epId ? { ...e, transaction: { ...tx, options: { ...tx.options, idempotentConsumers: true } } } : e,
          ),
        }));
        ui().toast(t('alerts.applied', { what: t('alerts.actions.makeIdempotent') }), 'success');
        return;
      }
      p.select({ nodes: [ep.serviceId], edges: [] });
      p.setHighlight(ep.id);
      p.setFocusEndpoint(ep.id);
      ui().setPropsTab('endpoints');
      break;
    }
    case 'enable':
      clearFaultsFor({ nodeId: alert.nodeId });
      break;
    case 'recover':
      clearFaultsFor({ nodeId: alert.nodeId }, 'nodeDown');
      for (const ep of p.schema.endpoints)
        if (ep.transaction?.coordinatorId === alert.nodeId || ep.serviceId === alert.nodeId)
          clearFaultsFor({ endpointId: ep.id }, 'coordinatorCrash');
      break;
  }
}
