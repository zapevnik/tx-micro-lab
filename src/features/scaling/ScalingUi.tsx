/**
 * Масштабирование БД в интерфейсе (ТЗ 5.4): три кнопки с пояснением, чем операции отличаются,
 * диалоги параметров и предупреждение о кросс-шардовых транзакциях после шардирования.
 */
import { Database, Layers, Repeat2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Dialog, Input, Label, Select, Tip } from '@/components/ui';
import { t } from '@/i18n';
import { nodeById } from '@/schema/analysis';
import { strParam } from '@/schema/params';
import type { PartitioningConfig, ReplicationConfig, SchemaNode, ShardingConfig } from '@/schema/types';
import { project, useProject } from '@/store/project';
import { ui, useUi } from '@/store/ui';
import { applyPartition, applyReplicate, applyShard, removePartition, removeReplicate, removeShard } from './actions';
import { canScale, DEFAULT_PARTITIONING, DEFAULT_REPLICATION, DEFAULT_SHARDING } from './scaling';

export function ScalingButtons({ node }: { node: SchemaNode }) {
  if (!canScale(node)) return null;
  const sc = node.scaling ?? {};
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-1.5">
        <Tip content={t('scaling.shard.explain')}>
          <Button size="sm" variant="secondary" className="h-auto flex-col gap-0.5 py-1.5" onClick={() => ui().openScale({ kind: 'shard', dbId: node.id })} data-testid="btn-shard">
            <Layers /> <span className="text-[11px]">{t('scaling.shard.button')}</span>
          </Button>
        </Tip>
        <Tip content={sc.sharding ? t('scaling.replicate.notForSharded') : t('scaling.replicate.explain')}>
          <span>
            <Button
              size="sm"
              variant="secondary"
              className="h-auto w-full flex-col gap-0.5 py-1.5"
              disabled={!!sc.sharding}
              onClick={() => ui().openScale({ kind: 'replicate', dbId: node.id })}
              data-testid="btn-replicate"
            >
              <Repeat2 /> <span className="text-[11px]">{t('scaling.replicate.button')}</span>
            </Button>
          </span>
        </Tip>
        <Tip content={t('scaling.partition.explain')}>
          <Button size="sm" variant="secondary" className="h-auto flex-col gap-0.5 py-1.5" onClick={() => ui().openScale({ kind: 'partition', dbId: node.id })}>
            <Database /> <span className="text-[11px]">{t('scaling.partition.button')}</span>
          </Button>
        </Tip>
      </div>
      {sc.sharding && (
        <Applied text={t('canvas.sharded', { n: sc.sharding.count, strategy: sc.sharding.strategy }) + ` · ${sc.sharding.key}`} onRemove={() => removeShard(node.id)} removeLabel={t('scaling.shard.remove')} />
      )}
      {sc.replication && (
        <Applied
          text={t('canvas.replicated', { n: sc.replication.count, mode: t(`scaling.replicate.${sc.replication.mode}`) })}
          onRemove={() => removeReplicate(node.id)}
          removeLabel={t('scaling.replicate.remove')}
        />
      )}
      {sc.partitioning && (
        <Applied text={`${sc.partitioning.table} · ${t('canvas.partitioned', { n: sc.partitioning.count })}`} onRemove={() => removePartition(node.id)} removeLabel={t('scaling.partition.remove')} />
      )}
    </div>
  );
}

function Applied({ text, onRemove, removeLabel }: { text: string; onRemove: () => void; removeLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
      <span className="truncate">{text}</span>
      <Button size="xs" variant="ghost" onClick={onRemove}>
        {removeLabel}
      </Button>
    </div>
  );
}

/** Диалоги масштабирования — один на всё приложение, управляется ui.scaleDialog. */
export function ScaleDialogs() {
  const dlg = useUi((s) => s.scaleDialog);
  const node = useProject((s) => (dlg ? nodeById(s.schema, dlg.dbId) : undefined));
  const close = () => ui().openScale(null);
  if (!dlg || !node) return null;
  if (dlg.kind === 'shard') return <ShardDialog node={node} close={close} />;
  if (dlg.kind === 'replicate') return <ReplicateDialog node={node} close={close} />;
  return <PartitionDialog node={node} close={close} />;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function intIn(v: string, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function ShardDialog({ node, close }: { node: SchemaNode; close: () => void }) {
  const [cfg, setCfg] = useState<ShardingConfig>(node.scaling?.sharding ?? DEFAULT_SHARDING);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={`${t('scaling.shard.title')} · ${node.name}`}
      description={t('scaling.shard.explain')}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => {
              applyShard(node.id, cfg);
              close();
            }}
            data-testid="apply-shard"
          >
            {t('common.apply')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Field label={t('scaling.shard.count')}>
          <Input type="number" min={2} max={8} value={cfg.count} onChange={(e) => setCfg({ ...cfg, count: intIn(e.target.value, 2, 8, cfg.count) })} data-testid="shard-count" />
        </Field>
        <Field label={t('scaling.shard.key')}>
          <Input value={cfg.key} onChange={(e) => setCfg({ ...cfg, key: e.target.value || 'id' })} />
        </Field>
        <Field label={t('scaling.shard.strategy')}>
          <Select value={cfg.strategy} onChange={(e) => setCfg({ ...cfg, strategy: e.target.value as 'hash' })}>
            <option value="hash">{t('scaling.shard.hash')}</option>
            <option value="range">{t('scaling.shard.range')}</option>
          </Select>
        </Field>
      </div>
      <OtherOps current="shard" />
    </Dialog>
  );
}

function ReplicateDialog({ node, close }: { node: SchemaNode; close: () => void }) {
  const [cfg, setCfg] = useState<ReplicationConfig>(node.scaling?.replication ?? DEFAULT_REPLICATION);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={`${t('scaling.replicate.title')} · ${node.name}`}
      description={t('scaling.replicate.explain')}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => {
              applyReplicate(node.id, cfg);
              close();
            }}
          >
            {t('common.apply')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('scaling.replicate.count')}>
          <Input type="number" min={1} max={5} value={cfg.count} onChange={(e) => setCfg({ ...cfg, count: intIn(e.target.value, 1, 5, cfg.count) })} />
        </Field>
        <Field label={t('scaling.replicate.mode')}>
          <Select value={cfg.mode} onChange={(e) => setCfg({ ...cfg, mode: e.target.value as 'sync' })}>
            <option value="sync">{t('scaling.replicate.sync')}</option>
            <option value="async">{t('scaling.replicate.async')}</option>
          </Select>
        </Field>
        <Field label={`${t('scaling.replicate.lag')}, ${t('units.ms')}`}>
          <Input type="number" min={0} value={cfg.lagMs} onChange={(e) => setCfg({ ...cfg, lagMs: intIn(e.target.value, 0, 60000, cfg.lagMs) })} />
        </Field>
        <Field label={t('scaling.replicate.readPolicy')}>
          <Select value={cfg.readPolicy} onChange={(e) => setCfg({ ...cfg, readPolicy: e.target.value as 'leader' })}>
            <option value="leader">{t('scaling.replicate.leader')}</option>
            <option value="replicas">{t('scaling.replicate.replicas')}</option>
          </Select>
        </Field>
      </div>
      <OtherOps current="replicate" />
    </Dialog>
  );
}

function PartitionDialog({ node, close }: { node: SchemaNode; close: () => void }) {
  const tables = strParam(node.params, 'database', 'tables')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const [cfg, setCfg] = useState<PartitioningConfig>(
    node.scaling?.partitioning ?? { ...DEFAULT_PARTITIONING, table: tables[0] ?? DEFAULT_PARTITIONING.table },
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={`${t('scaling.partition.title')} · ${node.name}`}
      description={t('scaling.partition.explain')}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => {
              applyPartition(node.id, cfg);
              close();
            }}
          >
            {t('common.apply')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Field label={t('scaling.partition.table')}>
          <Select value={cfg.table} onChange={(e) => setCfg({ ...cfg, table: e.target.value })}>
            {[...new Set([...tables, cfg.table])].map((tb) => (
              <option key={tb}>{tb}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('scaling.partition.key')}>
          <Input value={cfg.key} onChange={(e) => setCfg({ ...cfg, key: e.target.value || 'id' })} />
        </Field>
        <Field label={t('scaling.partition.count')}>
          <Input type="number" min={2} max={64} value={cfg.count} onChange={(e) => setCfg({ ...cfg, count: intIn(e.target.value, 2, 64, cfg.count) })} />
        </Field>
      </div>
      <OtherOps current="partition" />
    </Dialog>
  );
}

/** «Чем отличается от двух других» — короткое пояснение в каждом диалоге (5.4). */
function OtherOps({ current }: { current: 'shard' | 'replicate' | 'partition' }) {
  const others = (['shard', 'replicate', 'partition'] as const).filter((k) => k !== current);
  return (
    <div className="mt-4 space-y-1.5 rounded-md bg-muted/60 p-2.5">
      {others.map((k) => (
        <div key={k} className="text-[11px] leading-snug text-muted-foreground">
          <span className="font-semibold text-foreground">{t(`scaling.${k}.title`)}:</span> {t(`scaling.${k}.explain`)}
        </div>
      ))}
    </div>
  );
}

/** Предупреждение после шардирования (5.4, сценарий 2). */
export function ShardWarningDialog() {
  const w = useUi((s) => s.shardWarning);
  const schema = useProject((s) => s.schema);
  const [ep, setEp] = useState<string | null>(null);
  useEffect(() => setEp(w?.endpointIds[0] ?? null), [w]);
  if (!w) return null;
  const db = nodeById(schema, w.dbId);
  const eps = schema.endpoints.filter((e) => w.endpointIds.includes(e.id));
  const close = () => ui().setShardWarning(null);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={t('scaling.warningTitle')}
      description={t('scaling.warning', { db: db?.name ?? '', list: eps.map((e) => `«${e.name}»`).join(', ') })}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.close')}
          </Button>
          <Button
            variant="warn"
            onClick={() => {
              const target = eps.find((e) => e.id === ep) ?? eps[0];
              if (target) {
                project().select({ nodes: [target.serviceId], edges: [] });
                project().setHighlight(target.id);
                project().setFocusEndpoint(target.id);
                ui().setPropsTab('endpoints');
              }
              close();
            }}
            data-testid="choose-pattern"
          >
            {t('scaling.choosePattern')}
          </Button>
        </>
      }
    >
      {eps.length > 1 && (
        <Select value={ep ?? ''} onChange={(e) => setEp(e.target.value)}>
          {eps.map((e) => (
            <option key={e.id} value={e.id}>
              {nodeById(schema, e.serviceId)?.name} · {e.name}
            </option>
          ))}
        </Select>
      )}
    </Dialog>
  );
}
