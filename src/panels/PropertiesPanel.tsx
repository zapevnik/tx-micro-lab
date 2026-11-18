/**
 * Панель свойств (ТЗ 5.3): открывается при выборе узла или связи. Для сервиса — вкладки
 * «Параметры», «Эндпоинты», «Метрики»; для БД — кнопки масштабирования (5.4).
 * Без выделения — свойства проекта: название, seed, инварианты, расписание отказов, проблемы схемы.
 */
import { AlertCircle, AlertTriangle, RotateCcw } from 'lucide-react';
import { useEffect } from 'react';
import { Button, Input, Label, Section, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';
import { KIND_COLOR, nodeIcon } from '@/canvas/icons';
import { ProjectFaultSchedule } from '@/features/chaos/FaultSchedule';
import { EndpointEditor } from '@/features/endpoints/EndpointEditor';
import { LoadEditor } from '@/features/load/LoadEditor';
import { NodeCharts } from '@/features/metrics/MetricsCharts';
import { ScalingButtons } from '@/features/scaling/ScalingUi';
import { InvariantsEditor } from '@/features/transactions/InvariantsEditor';
import { t } from '@/i18n';
import { nodeById } from '@/schema/analysis';
import { defaultParams, PARAM_DEFS } from '@/schema/params';
import { setParam, updateEdge, updateNode } from '@/schema/ops';
import type { SchemaEdge, SchemaNode } from '@/schema/types';
import { project, useProject } from '@/store/project';
import { useSim } from '@/store/sim';
import { useUi, type PropsTab } from '@/store/ui';
import { issueText } from './issueText';
import { ParamField } from './ParamField';

export function PropertiesPanel() {
  const selection = useProject((s) => s.selection);
  const schema = useProject((s) => s.schema);
  const node = selection.nodes.length === 1 && selection.edges.length === 0 ? nodeById(schema, selection.nodes[0]) : undefined;
  const edge = selection.edges.length === 1 && selection.nodes.length === 0 ? schema.edges.find((e) => e.id === selection.edges[0]) : undefined;

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="properties">
      {node ? <NodeProps key={node.id} node={node} /> : edge ? <EdgeProps edge={edge} /> : <ProjectProps multi={selection.nodes.length + selection.edges.length} />}
    </div>
  );
}

function NodeProps({ node }: { node: SchemaNode }) {
  const running = useSim((s) => s.status !== 'idle');
  const tab = useUi((s) => s.propsTab);
  const setTab = useUi((s) => s.setPropsTab);
  const allIssues = useProject((s) => s.issues);
  const issues = allIssues.filter((i) => i.nodeId === node.id);
  const schema = useProject((s) => s.schema);
  const Icon = nodeIcon(node);
  const tabs: PropsTab[] =
    node.kind === 'client' ? ['load'] : node.kind === 'service' ? ['params', 'endpoints', 'metrics'] : ['params', 'metrics'];
  const active = tabs.includes(tab) ? tab : tabs[0];
  const parent = node.groupId ? nodeById(schema, node.groupId) : undefined;

  useEffect(() => {
    if (!tabs.includes(tab)) setTab(tabs[0]);
  }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md" style={{ background: `${KIND_COLOR[node.kind]}22`, color: KIND_COLOR[node.kind] }}>
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <Input
            className="h-7 border-transparent bg-transparent px-1 text-sm font-semibold hover:border-input"
            value={node.name}
            disabled={!!node.role}
            onChange={(e) => project().apply((s) => updateNode(s, node.id, { name: e.target.value }))}
            aria-label={t('props.name')}
          />
          <div className="px-1 text-[10.5px] uppercase tracking-wide text-muted-foreground">
            {node.scaling?.sharding ? t('kinds.router') : node.role ? t(`kinds.${node.role}`) : t(`kinds.${node.kind}`)}
          </div>
        </div>
      </div>
      {issues.length > 0 && (
        <div className="space-y-1 border-b border-border bg-red-500/5 px-3 py-2">
          {issues.map((i, k) => (
            <div key={k} className={`flex gap-1.5 text-[11.5px] leading-snug ${i.severity === 'error' ? 'text-red-300' : 'text-amber-300'}`}>
              {i.severity === 'error' ? <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
              {issueText(i)}
            </div>
          ))}
        </div>
      )}
      {parent && <div className="border-b border-border px-3 py-2 text-[11.5px] text-muted-foreground">{t('props.derived', { name: parent.name })}</div>}
      <Tabs value={active} onValueChange={(v) => setTab(v as PropsTab)} className="flex min-h-0 flex-1 flex-col">
        {tabs.length > 1 && (
          <TabsList>
            {tabs.map((k) => (
              <TabsTrigger key={k} value={k} data-testid={`props-tab-${k}`}>
                {t(`props.tabs.${k}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="load">
            <LoadEditor clientId={node.id} />
          </TabsContent>
          <TabsContent value="params">
            <ParamsTab node={node} running={running} />
          </TabsContent>
          <TabsContent value="endpoints">
            <EndpointEditor serviceId={node.id} />
          </TabsContent>
          <TabsContent value="metrics">
            <NodeCharts nodeId={node.id} isDb={node.kind === 'database'} />
          </TabsContent>
        </div>
      </Tabs>
    </>
  );
}

function ParamsTab({ node, running }: { node: SchemaNode; running: boolean }) {
  const defs = PARAM_DEFS[node.kind];
  return (
    <>
      {node.kind === 'database' && (
        <Section title={t('scaling.title')}>
          <ScalingButtons node={node} />
        </Section>
      )}
      <Section
        actions={
          defs.length > 0 && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => project().apply((s) => updateNode(s, node.id, { params: defaultParams(node.kind) }))}
              data-testid="reset-defaults"
            >
              <RotateCcw /> {t('props.resetDefaults')}
            </Button>
          )
        }
        title={t('props.tabs.params')}
      >
        {defs.length === 0 ? (
          <div className="text-xs text-muted-foreground">{t('props.noParams')}</div>
        ) : (
          <div className="space-y-3">
            {defs.map((d) => (
              <ParamField
                key={d.key}
                kind={node.kind}
                def={d}
                value={node.params[d.key]}
                running={running}
                onChange={(v) => project().apply((s) => setParam(s, node.id, d.key, v))}
              />
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

function EdgeProps({ edge }: { edge: SchemaEdge }) {
  const schema = useProject((s) => s.schema);
  const src = nodeById(schema, edge.source);
  const tgt = nodeById(schema, edge.target);
  const upd = (patch: Partial<SchemaEdge['network']>) => project().apply((s) => updateEdge(s, edge.id, { network: { ...edge.network, ...patch } }));
  return (
    <>
      <div className="border-b border-border px-3 py-3">
        <div className="text-sm font-semibold">{t('props.edge.title')}</div>
        <div className="text-xs text-muted-foreground">
          {src?.name} → {tgt?.name}
        </div>
      </div>
      {edge.kind !== 'call' ? (
        <Section>
          <div className="text-xs text-muted-foreground">{t('props.edge.internal')}</div>
        </Section>
      ) : (
        <Section title={t('props.tabs.params')}>
          <div className="space-y-3">
            <NumberRow label={t('props.edge.latency')} hint={t('props.edge.latencyHint')} unit={t('units.ms')} value={edge.network.latencyMs} max={10000} onChange={(v) => upd({ latencyMs: v })} />
            <NumberRow label={t('props.edge.loss')} hint={t('props.edge.lossHint')} unit="%" value={edge.network.lossPct} max={100} onChange={(v) => upd({ lossPct: v })} />
          </div>
        </Section>
      )}
    </>
  );
}

function NumberRow({ label, hint, unit, value, max, onChange }: { label: string; hint: string; unit: string; value: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="relative">
        <Input
          inputMode="decimal"
          defaultValue={value}
          key={value}
          onBlur={(e) => {
            const v = Number(e.target.value.replace(',', '.'));
            if (Number.isFinite(v) && v >= 0 && v <= max) onChange(v);
          }}
          className="pr-10"
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">{unit}</span>
      </div>
      <div className="text-[11px] leading-snug text-muted-foreground">{hint}</div>
    </div>
  );
}

function ProjectProps({ multi }: { multi: number }) {
  const schema = useProject((s) => s.schema);
  const issues = useProject((s) => s.issues);
  const running = useSim((s) => s.status !== 'idle');
  const errors = issues.filter((i) => i.severity === 'error').length;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="border-b border-border px-3 py-3 text-xs leading-relaxed text-muted-foreground">
        {multi > 1 ? t('props.multi', { n: multi }) : t('props.nothingSelected')}
      </div>
      <Section title={t('props.project')}>
        <div className="space-y-2.5">
          <div className="space-y-1">
            <Label>{t('props.projectName')}</Label>
            <Input value={schema.meta.name} onChange={(e) => project().apply((s) => ({ ...s, meta: { ...s.meta, name: e.target.value } }))} />
          </div>
          <div className="space-y-1">
            <Label>{t('props.seed')}</Label>
            <Input
              type="number"
              value={schema.seed}
              disabled={running}
              onChange={(e) => {
                const v = Math.round(Number(e.target.value));
                if (Number.isFinite(v)) project().apply((s) => ({ ...s, seed: v }));
              }}
            />
          </div>
        </div>
      </Section>
      <Section title={t('invariants.title')}>
        <InvariantsEditor />
      </Section>
      <Section title={t('chaos.scheduleTitle')}>
        <div className="mb-2 text-[11px] text-muted-foreground">{t('chaos.scheduleHint')}</div>
        <ProjectFaultSchedule />
      </Section>
      {issues.length > 0 && (
        <Section title={`${t('props.issuesTitle')} · ${t('canvas.issues', { errors, warnings: issues.length - errors })}`}>
          <ul className="space-y-1">
            {issues.map((i, k) => (
              <li
                key={k}
                className={`flex cursor-pointer gap-1.5 rounded px-1 py-0.5 text-[11.5px] leading-snug hover:bg-accent ${i.severity === 'error' ? 'text-red-300' : 'text-amber-300'}`}
                onClick={() => i.nodeId && project().select({ nodes: [i.nodeId], edges: [] })}
              >
                {i.severity === 'error' ? <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
                {issueText(i)}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
