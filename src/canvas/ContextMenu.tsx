/** Контекстные меню узла и связи (5.10 — отказы, 5.4 — масштабирование, 5.1 — правка). */
import {
  Clock,
  Copy,
  Layers,
  PencilLine,
  Power,
  PowerOff,
  Scissors,
  Snail,
  Split,
  Trash2,
  Repeat2,
  Unplug,
  Database,
  Skull,
  HeartPulse,
  Eraser,
} from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { canScale } from '@/features/scaling/scaling';
import { clearFaultsFor, injectFault } from '@/features/sim/controller';
import { t } from '@/i18n';
import { nodeById } from '@/schema/analysis';
import { updateNode } from '@/schema/ops';
import { useProject } from '@/store/project';
import { useSim } from '@/store/sim';
import { ui, useUi } from '@/store/ui';
import { copySelection, deleteElements } from './editing';

export function ContextMenu() {
  const menu = useUi((s) => s.contextMenu);
  const close = () => ui().openContextMenu(null);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  if (!menu) return null;
  return (
    <>
      <div className="fixed inset-0 z-40" onMouseDown={close} onContextMenu={(e) => (e.preventDefault(), close())} />
      <div
        className="hint-in fixed z-50 min-w-56 rounded-md border border-border bg-popover p-1 shadow-2xl"
        style={{ left: Math.min(menu.x, window.innerWidth - 260), top: Math.min(menu.y, window.innerHeight - 380) }}
        data-testid="context-menu"
      >
        {menu.target.type === 'node' ? <NodeMenu id={menu.target.id} close={close} /> : <EdgeMenu id={menu.target.id} close={close} />}
      </div>
    </>
  );
}

function Item({ icon, children, onClick, danger }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent [&_svg]:size-4 [&_svg]:shrink-0 ${danger ? 'text-red-400' : ''}`}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}

const Sep = () => <div className="my-1 h-px bg-border" />;

function askNumber(title: string, initial: number, onValue: (v: number) => void) {
  ui().ask({
    title,
    label: title,
    value: String(initial),
    onSubmit: (v) => {
      const n = Number(v.replace(',', '.'));
      if (Number.isFinite(n) && n >= 0) onValue(n);
    },
  });
}

function NodeMenu({ id, close }: { id: string; close: () => void }) {
  const schema = useProject((s) => s.schema);
  const faults = useSim((s) => s.faults);
  const node = nodeById(schema, id);
  if (!node) return null;
  const nodeFaults = Object.values(faults).filter((f) => 'nodeId' in f.action && f.action.nodeId === id);
  const isDown = nodeFaults.some((f) => f.action.type === 'nodeDown');
  const isSlow = nodeFaults.some((f) => f.action.type === 'nodeSlow');
  const coordinated = schema.endpoints.filter(
    (ep) =>
      ep.transaction &&
      (ep.transaction.pattern === '2pc' || ep.transaction.pattern === 'sagaOrchestration') &&
      (ep.transaction.coordinatorId ?? ep.serviceId) === id,
  );
  const crashed = Object.values(faults).some(
    (f) => f.action.type === 'coordinatorCrash' && coordinated.some((ep) => 'endpointId' in f.action && f.action.endpointId === ep.id),
  );
  const run = (fn: () => void) => () => {
    close();
    fn();
  };

  return (
    <>
      <div className="px-2 pb-1 pt-0.5 text-[11px] font-semibold text-muted-foreground">{node.name}</div>
      {!node.role && (
        <Item
          icon={<PencilLine />}
          onClick={run(() =>
            ui().ask({
              title: t('chaos.rename'),
              label: t('props.name'),
              value: node.name,
              onSubmit: (v) => v.trim() && useProject.getState().apply((s) => updateNode(s, id, { name: v.trim() })),
            }),
          )}
        >
          {t('chaos.rename')}
        </Item>
      )}
      {!node.role && (
        <Item icon={<Copy />} onClick={run(() => copySelection([id]))}>
          {t('chaos.copy')}
        </Item>
      )}
      <Sep />
      {isDown ? (
        <Item icon={<Power />} onClick={run(() => clearFaultsFor({ nodeId: id }, 'nodeDown'))}>
          {t('chaos.enable')}
        </Item>
      ) : (
        <Item icon={<PowerOff />} onClick={run(() => injectFault({ type: 'nodeDown', nodeId: id }))}>
          {t('chaos.disable')}
        </Item>
      )}
      {isSlow ? (
        <Item icon={<Snail />} onClick={run(() => clearFaultsFor({ nodeId: id }, 'nodeSlow'))}>
          {t('chaos.unslow')}
        </Item>
      ) : (
        <Item icon={<Snail />} onClick={run(() => askNumber(t('chaos.slowPrompt'), 5, (k) => k > 1 && injectFault({ type: 'nodeSlow', nodeId: id, factor: k })))}>
          {t('chaos.slow')}
        </Item>
      )}
      {coordinated.map((ep) =>
        ep.transaction!.pattern === '2pc' ? (
          <Item key={ep.id} icon={<Skull />} onClick={run(() => injectFault({ type: 'coordinatorCrash', endpointId: ep.id, after: 'prepare' }))}>
            {t('chaos.crash2pc')} · {ep.name}
          </Item>
        ) : (
          <Item
            key={ep.id}
            icon={<Skull />}
            onClick={run(() =>
              askNumber(t('chaos.crashSagaPrompt'), 1, (n) =>
                injectFault({ type: 'coordinatorCrash', endpointId: ep.id, after: 'step', stepIndex: Math.max(0, Math.round(n) - 1) }),
              ),
            )}
          >
            {t('chaos.crashSaga')} · {ep.name}
          </Item>
        ),
      )}
      {crashed && (
        <Item icon={<HeartPulse />} onClick={run(() => coordinated.forEach((ep) => clearFaultsFor({ endpointId: ep.id }, 'coordinatorCrash')))}>
          {t('chaos.recover')}
        </Item>
      )}
      {canScale(node) && (
        <>
          <Sep />
          <Item icon={<Layers />} onClick={run(() => ui().openScale({ kind: 'shard', dbId: id }))}>
            {t('scaling.shard.button')}
          </Item>
          {!node.scaling?.sharding && (
            <Item icon={<Repeat2 />} onClick={run(() => ui().openScale({ kind: 'replicate', dbId: id }))}>
              {t('scaling.replicate.button')}
            </Item>
          )}
          <Item icon={<Database />} onClick={run(() => ui().openScale({ kind: 'partition', dbId: id }))}>
            {t('scaling.partition.button')}
          </Item>
        </>
      )}
      {!node.role && (
        <>
          <Sep />
          <Item danger icon={<Trash2 />} onClick={run(() => deleteElements([id], []))}>
            {t('chaos.delete')}
          </Item>
        </>
      )}
    </>
  );
}

function EdgeMenu({ id, close }: { id: string; close: () => void }) {
  const edge = useProject((s) => s.schema.edges.find((e) => e.id === id));
  const faults = useSim((s) => s.faults);
  if (!edge) return null;
  const hasFaults = Object.values(faults).some((f) => 'edgeId' in f.action && f.action.edgeId === id);
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  return (
    <>
      <Item icon={<Clock />} onClick={run(() => askNumber(t('chaos.delayPrompt'), 200, (v) => injectFault({ type: 'linkDelay', edgeId: id, delayMs: v })))}>
        {t('chaos.delay')}
      </Item>
      <Item icon={<Unplug />} onClick={run(() => askNumber(t('chaos.lossPrompt'), 10, (v) => injectFault({ type: 'linkLoss', edgeId: id, pct: Math.min(100, v) })))}>
        {t('chaos.loss')}
      </Item>
      <Item icon={<Split />} onClick={run(() => askNumber(t('chaos.duplicatePrompt'), 10, (v) => injectFault({ type: 'linkDuplicate', edgeId: id, pct: Math.min(100, v) })))}>
        {t('chaos.duplicate')}
      </Item>
      <Item icon={<Scissors />} onClick={run(() => injectFault({ type: 'linkPartition', edgeId: id }))}>
        {t('chaos.partition')}
      </Item>
      {hasFaults && (
        <Item icon={<Eraser />} onClick={run(() => clearFaultsFor({ edgeId: id }))}>
          {t('chaos.clear')}
        </Item>
      )}
      {edge.kind === 'call' && (
        <>
          <Sep />
          <Item danger icon={<Trash2 />} onClick={run(() => deleteElements([], [id]))}>
            {t('chaos.delete')}
          </Item>
        </>
      )}
    </>
  );
}
