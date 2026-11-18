/**
 * Редактор поведения сервиса (ТЗ 5.5, 5.6): эндпоинты и обработчики сообщений, цепочки шагов
 * с перетаскиванием, выбор цели из связанных узлов, действие над данными из словаря,
 * отметка диапазона как бизнес-транзакции, паттерн, координатор, опции и компенсации.
 */
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Eye,
  GripVertical,
  Mail,
  Plus,
  Trash2,
  Undo2,
  Globe,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Input, Label, Select, Switch, Tip } from '@/components/ui';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import {
  allTopics,
  httpEndpointsOf,
  nodeById,
  stepTargetOptions,
  txNeedsDistributedPattern,
  txSteps,
} from '@/schema/analysis';
import { actionsForStep, compensationOf } from '@/schema/dictionary';
import {
  addEndpoint,
  addStep,
  createStep,
  defaultTransaction,
  moveStep,
  removeEndpoint,
  removeStep,
  setPattern,
  setTransaction,
  updateEndpoint,
  updateStep,
} from '@/schema/ops';
import { STEP_TYPES, TX_PATTERNS, type Endpoint, type Schema, type Step, type StepType, type Transaction } from '@/schema/types';
import { project, useProject } from '@/store/project';

const apply = (fn: (s: Schema) => Schema) => project().apply(fn);

export function EndpointEditor({ serviceId }: { serviceId: string }) {
  const schema = useProject((s) => s.schema);
  const focus = useProject((s) => s.focusEndpoint);
  const endpoints = schema.endpoints.filter((e) => e.serviceId === serviceId);
  const [open, setOpen] = useState<string | null>(endpoints[0]?.id ?? null);

  useEffect(() => {
    if (focus && endpoints.some((e) => e.id === focus)) {
      setOpen(focus);
      project().setFocusEndpoint(null);
    }
  }, [focus, endpoints]);

  const add = (kind: 'http' | 'message') => {
    let id = '';
    apply((s) => {
      const next = addEndpoint(
        s,
        serviceId,
        kind === 'http' ? t('endpoints.newName') : `on ${allTopics(s)[0] ?? 'topic'}`,
        kind === 'http' ? { type: 'http', method: 'POST' } : { type: 'message', topic: allTopics(s)[0] ?? '' },
      );
      id = next.endpoints[next.endpoints.length - 1].id;
      return next;
    });
    setOpen(id);
  };

  return (
    <div className="space-y-2 p-3">
      <div className="flex gap-1.5">
        <Button size="sm" variant="secondary" onClick={() => add('http')} data-testid="add-endpoint">
          <Plus /> {t('endpoints.add')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => add('message')}>
          <Plus /> {t('endpoints.addHandler')}
        </Button>
      </div>
      {endpoints.length === 0 && <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">{t('endpoints.empty')}</div>}
      {endpoints.map((ep) => (
        <EndpointCard
          key={ep.id}
          ep={ep}
          schema={schema}
          open={open === ep.id}
          onToggle={() => {
            const next = open === ep.id ? null : ep.id;
            setOpen(next);
            project().setHighlight(next);
          }}
        />
      ))}
    </div>
  );
}

function EndpointCard({ ep, schema, open, onToggle }: { ep: Endpoint; schema: Schema; open: boolean; onToggle: () => void }) {
  const highlighted = useProject((s) => s.highlightEndpoint === ep.id);
  const tx = ep.transaction;
  const inTx = new Set(txSteps(ep).map((s) => s.id));
  const spread = txNeedsDistributedPattern(schema, ep);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const allIssues = useProject((s) => s.issues);
  const issues = allIssues.filter((i) => i.endpointId === ep.id && i.severity === 'error');

  return (
    <div className={cn('rounded-md border bg-card/50', highlighted ? 'border-violet-400/60' : 'border-border')} data-testid={`endpoint-${ep.name}`}>
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button className="cursor-pointer text-muted-foreground" onClick={onToggle}>
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        {ep.trigger.type === 'http' ? <Globe className="size-3.5 text-sky-400" /> : <Mail className="size-3.5 text-violet-400" />}
        <button className="min-w-0 flex-1 cursor-pointer truncate text-left text-[13px] font-medium" onClick={onToggle}>
          {ep.name}
        </button>
        {tx && tx.pattern !== 'none' && (
          <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">{t(`tx.patterns.${tx.pattern}`)}</span>
        )}
        {issues.length > 0 && <AlertTriangle className="size-3.5 text-red-400" />}
        <Tip content={t('tx.highlight')}>
          <button
            className={cn('cursor-pointer rounded p-0.5 hover:bg-accent', highlighted ? 'text-violet-300' : 'text-muted-foreground')}
            onClick={() => project().setHighlight(highlighted ? null : ep.id)}
          >
            <Eye className="size-3.5" />
          </button>
        </Tip>
      </div>

      {open && (
        <div className="space-y-3 border-t border-border px-2 pb-2 pt-2">
          {/* Заголовок */}
          <div className="grid grid-cols-[90px_1fr] gap-1.5">
            {ep.trigger.type === 'http' ? (
              <Select
                value={ep.trigger.method}
                onChange={(e) => apply((s) => updateEndpoint(s, ep.id, { trigger: { type: 'http', method: e.target.value as 'GET' } }))}
              >
                {['GET', 'POST', 'PUT', 'DELETE'].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            ) : (
              <div className="flex h-8 items-center text-xs text-muted-foreground">{t('endpoints.handler')}</div>
            )}
            <Input value={ep.name} onChange={(e) => apply((s) => updateEndpoint(s, ep.id, { name: e.target.value }))} aria-label={t('endpoints.name')} />
          </div>
          {ep.trigger.type === 'message' && (
            <div className="space-y-1">
              <Label>{t('endpoints.topic')}</Label>
              <TopicInput value={ep.trigger.topic} schema={schema} onChange={(topic) => apply((s) => updateEndpoint(s, ep.id, { trigger: { type: 'message', topic } }))} />
            </div>
          )}

          {/* Шаги */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label>{t('endpoints.steps')}</Label>
              <AddStep onAdd={(type) => apply((s) => addStep(s, ep.id, createStep(type)))} />
            </div>
            {ep.steps.length === 0 && <div className="py-2 text-center text-xs text-muted-foreground">{t('endpoints.noSteps')}</div>}
            <ol className="space-y-1">
              {ep.steps.map((step, i) => (
                <li
                  key={step.id}
                  draggable
                  onDragStart={(e) => {
                    setDragIdx(i);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', step.id);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOverIdx(i);
                  }}
                  onDragEnd={() => {
                    setDragIdx(null);
                    setOverIdx(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIdx !== null && dragIdx !== i) apply((s) => moveStep(s, ep.id, dragIdx, i));
                    setDragIdx(null);
                    setOverIdx(null);
                  }}
                  className={cn(
                    'rounded-md border border-border bg-background/50 transition-colors',
                    inTx.has(step.id) && tx?.pattern !== 'none' && 'border-l-2 border-l-violet-400',
                    overIdx === i && dragIdx !== null && dragIdx !== i && 'border-primary',
                    dragIdx === i && 'opacity-50',
                  )}
                >
                  <StepRow ep={ep} step={step} index={i} schema={schema} tx={tx} inTx={inTx.has(step.id)} />
                </li>
              ))}
            </ol>
          </div>

          {/* Транзакция */}
          <TxEditor ep={ep} schema={schema} spread={spread} />

          <div className="flex justify-end">
            <Button size="xs" variant="ghost" className="text-red-400" onClick={() => apply((s) => removeEndpoint(s, ep.id))}>
              <Trash2 /> {t('endpoints.deleteEndpoint')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddStep({ onAdd }: { onAdd: (t: StepType) => void }) {
  return (
    <Select
      className="h-6 w-auto py-0 text-xs"
      value=""
      onChange={(e) => e.target.value && onAdd(e.target.value as StepType)}
      data-testid="add-step"
    >
      <option value="">+ {t('endpoints.addStep')}</option>
      {STEP_TYPES.map((s) => (
        <option key={s} value={s}>
          {t(`endpoints.stepTypes.${s}`)}
        </option>
      ))}
    </Select>
  );
}

function TopicInput({ value, schema, onChange }: { value: string; schema: Schema; onChange: (v: string) => void }) {
  const listId = 'topics-list';
  return (
    <>
      <Input value={value} list={listId} placeholder={t('endpoints.topicPlaceholder')} onChange={(e) => onChange(e.target.value)} />
      <datalist id={listId}>
        {allTopics(schema).map((tp) => (
          <option key={tp} value={tp} />
        ))}
      </datalist>
    </>
  );
}

function StepRow({ ep, step, index, schema, tx, inTx }: { ep: Endpoint; step: Step; index: number; schema: Schema; tx: Transaction | null; inTx: boolean }) {
  const targets = stepTargetOptions(schema, ep.serviceId, step.type);
  const upd = (patch: Partial<Step>) => apply((s) => updateStep(s, ep.id, step.id, patch));
  const actions = actionsForStep(step.type);
  const comp = compensationOf(step.action);
  const showComp = inTx && comp && tx && (tx.pattern === 'sagaOrchestration' || tx.pattern === 'sagaChoreography' || tx.pattern === 'tcc');
  const callee = step.type === 'call' && step.targetId ? httpEndpointsOf(schema, step.targetId) : [];

  return (
    <div className="space-y-1 p-1.5">
      <div className="flex items-center gap-1">
        <Tip content={t('endpoints.dragHint')}>
          <GripVertical className="size-3.5 shrink-0 cursor-grab text-muted-foreground" />
        </Tip>
        <span className="w-4 shrink-0 text-center font-mono text-[11px] text-muted-foreground">{index + 1}</span>
        <Select
          className="h-7 flex-1 text-xs"
          value={step.type}
          onChange={(e) => {
            const type = e.target.value as StepType;
            upd({ ...createStep(type), id: step.id });
          }}
        >
          {STEP_TYPES.map((s) => (
            <option key={s} value={s}>
              {t(`endpoints.stepTypes.${s}`)}
            </option>
          ))}
        </Select>
        <button className="shrink-0 cursor-pointer rounded p-1 text-muted-foreground hover:bg-accent hover:text-red-400" onClick={() => apply((s) => removeStep(s, ep.id, step.id))}>
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <div className="space-y-1 pl-9">
        {step.type !== 'compute' && (
          <Select
            className={cn('h-7 text-xs', !step.targetId && 'border-red-500/60')}
            value={step.targetId ?? ''}
            onChange={(e) => upd({ targetId: e.target.value || null, targetEndpointId: step.type === 'call' ? null : step.targetEndpointId })}
          >
            <option value="">{targets.length ? `${t('endpoints.target')}: ${t('common.notSelected')}` : t('endpoints.noTargets')}</option>
            {targets.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
            {step.targetId && !targets.some((n) => n.id === step.targetId) && (
              <option value={step.targetId}>{nodeById(schema, step.targetId)?.name ?? step.targetId} ⚠</option>
            )}
          </Select>
        )}
        {step.type === 'call' && step.targetId && (
          <Select className="h-7 text-xs" value={step.targetEndpointId ?? ''} onChange={(e) => upd({ targetEndpointId: e.target.value || null })}>
            <option value="">{t('endpoints.targetEndpoint')}: {t('common.notSelected')}</option>
            {callee.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        {step.type === 'publish' && <TopicInput value={step.topic ?? ''} schema={schema} onChange={(topic) => upd({ topic })} />}
        {actions.length > 0 && (
          <Select className="h-7 text-xs" value={step.action ?? ''} onChange={(e) => upd({ action: e.target.value || null })}>
            <option value="">{t('endpoints.action')}: {t('common.notSelected')}</option>
            {actions.map((a) => (
              <option key={a.id} value={a.id}>
                {t(`actions.${a.id as 'readAccount'}`)} ({a.table})
              </option>
            ))}
          </Select>
        )}
        {step.type === 'compute' && (
          <div className="flex items-center gap-1.5">
            <Input
              className="h-7 w-20 text-xs"
              inputMode="decimal"
              value={step.durationMs}
              onChange={(e) => {
                const v = Number(e.target.value.replace(',', '.'));
                if (Number.isFinite(v) && v >= 0) upd({ durationMs: v });
              }}
            />
            <span className="text-[11px] text-muted-foreground">{t('units.ms')}</span>
          </div>
        )}
        {showComp && comp && (
          <div className="flex items-center gap-1.5 rounded bg-orange-500/10 px-1.5 py-1 text-[11px] text-orange-300">
            <Undo2 className="size-3 shrink-0" />
            <span className="flex-1 truncate">
              {t('endpoints.compensation')}: {t(`actions.${comp.id as 'readAccount'}`)}
            </span>
            <Input
              className="h-6 w-14 px-1 text-[11px]"
              inputMode="decimal"
              value={step.compensationDurationMs ?? 5}
              title={t('endpoints.compensationTime')}
              onChange={(e) => {
                const v = Number(e.target.value.replace(',', '.'));
                if (Number.isFinite(v) && v >= 0) upd({ compensationDurationMs: v });
              }}
            />
            <span>{t('units.ms')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function TxEditor({ ep, schema, spread }: { ep: Endpoint; schema: Schema; spread: ReturnType<typeof txNeedsDistributedPattern> }) {
  const tx = ep.transaction;
  const services = schema.nodes.filter((n) => n.kind === 'service');
  if (!tx)
    return (
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        disabled={ep.steps.length === 0}
        onClick={() => apply((s) => setTransaction(s, ep.id, defaultTransaction(ep)))}
        data-testid="mark-tx"
      >
        {t('tx.mark')}
      </Button>
    );
  const setTx = (patch: Partial<Transaction>) => apply((s) => setTransaction(s, ep.id, { ...tx, ...patch }));
  const setOpt = (patch: Partial<Transaction['options']>) => setTx({ options: { ...tx.options, ...patch } });
  const needsCoord = tx.pattern === '2pc' || tx.pattern === 'sagaOrchestration';
  const isSaga = tx.pattern === 'sagaOrchestration' || tx.pattern === 'sagaChoreography' || tx.pattern === 'tcc';

  return (
    <div className="space-y-2 rounded-md border border-violet-500/30 bg-violet-500/5 p-2" data-testid="tx-editor">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-violet-300">{t('tx.title')}</div>
        <Button size="xs" variant="ghost" onClick={() => apply((s) => setTransaction(s, ep.id, null))}>
          {t('tx.remove')}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <div className="space-y-1">
          <Label>{t('tx.from')}</Label>
          <Select className="h-7 text-xs" value={tx.fromStepId} onChange={(e) => setTx({ fromStepId: e.target.value })}>
            {ep.steps.map((s, i) => (
              <option key={s.id} value={s.id}>
                {i + 1}. {t(`endpoints.stepTypes.${s.type}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{t('tx.to')}</Label>
          <Select className="h-7 text-xs" value={tx.toStepId} onChange={(e) => setTx({ toStepId: e.target.value })}>
            {ep.steps.map((s, i) => (
              <option key={s.id} value={s.id}>
                {i + 1}. {t(`endpoints.stepTypes.${s.type}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label>{t('tx.pattern')}</Label>
        <Select value={tx.pattern} onChange={(e) => apply((s) => setPattern(s, ep.id, e.target.value as Transaction['pattern']))} data-testid="tx-pattern">
          {TX_PATTERNS.map((p) => (
            <option key={p} value={p}>
              {t(`tx.patterns.${p}`)}
            </option>
          ))}
        </Select>
        <div className="text-[11px] leading-snug text-muted-foreground">{t(`tx.patternHints.${tx.pattern}`)}</div>
      </div>
      {spread && (
        <div className="flex gap-1.5 rounded bg-amber-500/10 p-1.5 text-[11px] leading-snug text-amber-300" data-testid="tx-spread-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {spread === 'crossShard' ? t('tx.crossShard') : t('tx.multiDb')}
        </div>
      )}
      {needsCoord && (
        <div className="space-y-1">
          <Label>{t('tx.coordinator')}</Label>
          <Select className="h-7 text-xs" value={tx.coordinatorId ?? ''} onChange={(e) => setTx({ coordinatorId: e.target.value || null })}>
            <option value="">{t('common.notSelected')}</option>
            {services.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      {tx.pattern !== 'none' && tx.pattern !== 'local' && (
        <div className="space-y-1.5">
          <Label>{t('tx.options')}</Label>
          <ToggleRow label={t('tx.outbox')} hint={t('tx.outboxHint')} checked={tx.options.outbox} onChange={(v) => setOpt({ outbox: v })} />
          <ToggleRow
            label={t('tx.idempotent')}
            hint={t('tx.idempotentHint')}
            checked={tx.options.idempotentConsumers}
            onChange={(v) => setOpt({ idempotentConsumers: v })}
            testId="toggle-idempotent"
          />
          <div className="grid grid-cols-2 gap-1.5">
            <NumberMini label={`${t('tx.phaseTimeout')}, ${t('units.ms')}`} value={tx.options.phaseTimeoutMs} onChange={(v) => setOpt({ phaseTimeoutMs: v })} />
            <NumberMini label={t('tx.retries')} value={tx.options.retries} max={10} integer onChange={(v) => setOpt({ retries: v })} />
          </div>
        </div>
      )}
      {isSaga && <div className="text-[11px] text-orange-300/80">↩ {t('tx.compensationsAuto')}</div>}
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange, testId }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <div className="flex items-center justify-between gap-2" data-testid={testId}>
      <Tip content={hint}>
        <span className="cursor-help text-xs">{label}</span>
      </Tip>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function NumberMini({ label, value, onChange, max = 1e6, integer }: { label: string; value: number; onChange: (v: number) => void; max?: number; integer?: boolean }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10.5px]">{label}</Label>
      <Input
        className="h-7 text-xs"
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value.replace(',', '.'));
          if (Number.isFinite(v) && v >= 0 && v <= max && (!integer || Number.isInteger(v))) onChange(v);
        }}
      />
    </div>
  );
}
