/**
 * Расписание отказов (ТЗ 5.10): «на 30-й секунде отключить узел X на 10 с» — сценарий
 * повторяется в каждом запуске и используется в режиме сравнения.
 */
import { Plus, Trash2 } from 'lucide-react';
import { Button, Input, Label, Select } from '@/components/ui';
import { describeFault } from '@/features/sim/controller';
import { t } from '@/i18n';
import { newId } from '@/schema/ids';
import type { FaultAction, FaultType, Schema, ScheduledFault } from '@/schema/types';
import { project, useProject } from '@/store/project';

const TYPES: FaultType[] = ['nodeDown', 'nodeSlow', 'linkDelay', 'linkLoss', 'linkDuplicate', 'linkPartition', 'coordinatorCrash'];

export function defaultAction(type: FaultType, schema: Schema): FaultAction | null {
  const node = schema.nodes.find((n) => n.kind === 'service') ?? schema.nodes[0];
  const edge = schema.edges.find((e) => e.kind === 'call');
  const ep = schema.endpoints.find((e) => e.transaction && (e.transaction.pattern === '2pc' || e.transaction.pattern === 'sagaOrchestration'));
  switch (type) {
    case 'nodeDown':
      return node ? { type, nodeId: node.id } : null;
    case 'nodeSlow':
      return node ? { type, nodeId: node.id, factor: 5 } : null;
    case 'linkDelay':
      return edge ? { type, edgeId: edge.id, delayMs: 200 } : null;
    case 'linkLoss':
    case 'linkDuplicate':
      return edge ? { type, edgeId: edge.id, pct: 10 } : null;
    case 'linkPartition':
      return edge ? { type, edgeId: edge.id } : null;
    case 'coordinatorCrash':
      return ep ? { type, endpointId: ep.id, after: ep.transaction!.pattern === '2pc' ? 'prepare' : 'step', stepIndex: 0 } : null;
  }
}

export function FaultScheduleEditor({ value, onChange }: { value: ScheduledFault[]; onChange: (f: ScheduledFault[]) => void }) {
  const schema = useProject((s) => s.schema);
  const upd = (id: string, patch: Partial<ScheduledFault>) => onChange(value.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  const add = () => {
    const action = defaultAction('nodeDown', schema);
    if (action) onChange([...value, { id: newId('f'), atS: 20, durationS: 10, action }]);
  };

  return (
    <div className="space-y-2">
      {value.length === 0 && <div className="text-xs text-muted-foreground">{t('chaos.scheduleEmpty')}</div>}
      {value.map((f) => (
        <div key={f.id} className="space-y-1.5 rounded-md border border-border bg-background/40 p-2">
          <div className="flex items-center gap-1.5">
            <Select
              className="h-7 flex-1 text-xs"
              value={f.action.type}
              onChange={(e) => {
                const a = defaultAction(e.target.value as FaultType, schema);
                if (a) upd(f.id, { action: a });
              }}
            >
              {TYPES.map((tp) => (
                <option key={tp} value={tp}>
                  {t(`chaos.types.${tp}`)}
                </option>
              ))}
            </Select>
            <button className="cursor-pointer rounded p-1 text-muted-foreground hover:text-red-400" onClick={() => onChange(value.filter((x) => x.id !== f.id))}>
              <Trash2 className="size-3.5" />
            </button>
          </div>
          <TargetSelect action={f.action} schema={schema} onChange={(action) => upd(f.id, { action })} />
          <div className="grid grid-cols-2 gap-1.5">
            <div className="space-y-0.5">
              <Label className="text-[10.5px]">{t('chaos.atLabel')}</Label>
              <Input className="h-7 text-xs" type="number" min={0} value={f.atS} onChange={(e) => upd(f.id, { atS: Math.max(0, Number(e.target.value) || 0) })} />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[10.5px]">{t('chaos.durationLabel')}</Label>
              <Input className="h-7 text-xs" type="number" min={0} value={f.durationS} onChange={(e) => upd(f.id, { durationS: Math.max(0, Number(e.target.value) || 0) })} />
            </div>
          </div>
          <div className="text-[10.5px] text-muted-foreground">
            {t('chaos.at', { at: f.atS })} · {describeFault(f.action, schema)} · {f.durationS ? t('chaos.for', { d: f.durationS }) : t('chaos.forever')}
          </div>
        </div>
      ))}
      <Button size="xs" variant="secondary" onClick={add} disabled={!schema.nodes.length}>
        <Plus /> {t('chaos.scheduleAdd')}
      </Button>
    </div>
  );
}

function TargetSelect({ action, schema, onChange }: { action: FaultAction; schema: Schema; onChange: (a: FaultAction) => void }) {
  const nodeName = (id: string) => schema.nodes.find((n) => n.id === id)?.name ?? id;
  if ('nodeId' in action)
    return (
      <div className="flex gap-1.5">
        <Select className="h-7 flex-1 text-xs" value={action.nodeId} onChange={(e) => onChange({ ...action, nodeId: e.target.value })}>
          {schema.nodes.filter((n) => n.kind !== 'client').map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </Select>
        {action.type === 'nodeSlow' && (
          <Input className="h-7 w-16 text-xs" type="number" min={1} value={action.factor} onChange={(e) => onChange({ ...action, factor: Math.max(1, Number(e.target.value) || 1) })} />
        )}
      </div>
    );
  if ('edgeId' in action)
    return (
      <div className="flex gap-1.5">
        <Select className="h-7 flex-1 text-xs" value={action.edgeId} onChange={(e) => onChange({ ...action, edgeId: e.target.value })}>
          {schema.edges.filter((e) => e.kind === 'call').map((e) => (
            <option key={e.id} value={e.id}>
              {nodeName(e.source)} → {nodeName(e.target)}
            </option>
          ))}
        </Select>
        {action.type === 'linkDelay' && (
          <Input className="h-7 w-20 text-xs" type="number" min={0} value={action.delayMs} onChange={(e) => onChange({ ...action, delayMs: Math.max(0, Number(e.target.value) || 0) })} />
        )}
        {(action.type === 'linkLoss' || action.type === 'linkDuplicate') && (
          <Input className="h-7 w-16 text-xs" type="number" min={0} max={100} value={action.pct} onChange={(e) => onChange({ ...action, pct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} />
        )}
      </div>
    );
  const eps = schema.endpoints.filter((e) => e.transaction && (e.transaction.pattern === '2pc' || e.transaction.pattern === 'sagaOrchestration'));
  return (
    <Select className="h-7 text-xs" value={action.endpointId} onChange={(e) => onChange({ ...action, endpointId: e.target.value })}>
      {eps.map((e) => (
        <option key={e.id} value={e.id}>
          {nodeName(e.serviceId)} · {e.name}
        </option>
      ))}
    </Select>
  );
}

export function ProjectFaultSchedule() {
  const faults = useProject((s) => s.schema.faults);
  return <FaultScheduleEditor value={faults} onChange={(f) => project().apply((s) => ({ ...s, faults: f }))} />;
}
