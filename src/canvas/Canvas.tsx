/**
 * Холст (ТЗ 5.1): перетаскивание из палитры, связи с проверкой допустимости, масштаб и панорама,
 * мини-карта, привязка к сетке, выбор рамкой (Shift + перетаскивание).
 * Источник правды — схема в useProject; узлы React Flow строятся из неё.
 */
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { MousePointerClick } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, type DragEvent } from 'react';
import { t } from '@/i18n';
import { nodeById } from '@/schema/analysis';
import { addNode, connect, createNode, moveNodes } from '@/schema/ops';
import { NODE_KINDS, type NodeKind, type Schema } from '@/schema/types';
import { project, useProject } from '@/store/project';
import { useSim } from '@/store/sim';
import { ui } from '@/store/ui';
import { ContextMenu } from './ContextMenu';
import { FlowLayer } from './FlowLayer';
import { edgeHandles } from './geometry';
import { KIND_COLOR } from './icons';
import { SystemEdge } from './SystemEdge';
import { SystemNode } from './SystemNode';

const nodeTypes = { system: SystemNode };
const edgeTypes = { system: SystemEdge };
export const DND_MIME = 'application/x-dtx-node';

function defaultName(schema: Schema, kind: NodeKind): string {
  const base = t(`kinds.${kind}`);
  let i = schema.nodes.filter((n) => n.kind === kind && !n.role).length + 1;
  while (schema.nodes.some((n) => n.name === `${base} ${i}`)) i++;
  return `${base} ${i}`;
}

export function Canvas() {
  const schema = useProject((s) => s.schema);
  const selection = useProject((s) => s.selection);
  const running = useSim((s) => s.status !== 'idle');
  const { screenToFlowPosition } = useReactFlow();
  const measured = useRef(new Map<string, { width: number; height: number }>());
  const [dimsVersion, bump] = useState(0);
  const dragBefore = useRef<Schema | null>(null);

  const selNodes = useMemo(() => new Set(selection.nodes), [selection.nodes]);
  const selEdges = useMemo(() => new Set(selection.edges), [selection.edges]);

  const nodes: Node[] = useMemo(
    () =>
      schema.nodes.map((n) => ({
        id: n.id,
        type: 'system',
        position: n.position,
        data: {},
        selected: selNodes.has(n.id),
        measured: measured.current.get(n.id),
        connectable: !n.role,
        zIndex: n.role ? 0 : 1,
      })),
    // measured хранится в ref; dimsVersion сообщает, что размеры обновились.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schema.nodes, selNodes, dimsVersion],
  );

  const edges: Edge[] = useMemo(() => {
    const byId = new Map(schema.nodes.map((n) => [n.id, n]));
    return schema.edges.map((e) => {
      const h = edgeHandles(e, byId.get(e.source), byId.get(e.target));
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: h.source,
        targetHandle: h.target,
        type: 'system',
        selected: selEdges.has(e.id),
        zIndex: e.kind === 'call' ? 0 : -1,
      };
    });
  }, [schema.edges, schema.nodes, selEdges]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const positions: Record<string, { x: number; y: number }> = {};
    let dims = false;
    let sel: Set<string> | null = null;
    for (const c of changes) {
      if (c.type === 'position' && c.position) positions[c.id] = c.position;
      if (c.type === 'dimensions' && c.dimensions) {
        measured.current.set(c.id, c.dimensions);
        dims = true;
      }
      if (c.type === 'select') {
        sel ??= new Set(project().selection.nodes);
        if (c.selected) sel.add(c.id);
        else sel.delete(c.id);
      }
    }
    if (Object.keys(positions).length) project().apply((s) => moveNodes(s, positions), { history: false, structural: false });
    if (sel) project().select({ nodes: [...sel] });
    if (dims) bump((x) => x + 1);
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    let sel: Set<string> | null = null;
    for (const c of changes)
      if (c.type === 'select') {
        sel ??= new Set(project().selection.edges);
        if (c.selected) sel.add(c.id);
        else sel.delete(c.id);
      }
    if (sel) project().select({ edges: [...sel] });
  }, []);

  const onConnect = useCallback((c: Connection) => {
    const s = project().schema;
    const r = connect(s, c.source, c.target);
    if ('error' in r) {
      const src = nodeById(s, c.source);
      const tgt = nodeById(s, c.target);
      ui().toast(
        t(`canvas.connectErrors.${r.error}`, {
          source: src?.name ?? '',
          sourceKind: src ? t(`kinds.${src.kind}`) : '',
          targetKind: tgt ? t(`kinds.${tgt.kind}`) : '',
        }),
        'error',
      );
      return;
    }
    project().apply(() => r.schema);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const kind = e.dataTransfer.getData(DND_MIME) as NodeKind;
      if (!NODE_KINDS.includes(kind)) return;
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const node = createNode(kind, defaultName(project().schema, kind), { x: Math.round(pos.x - 100), y: Math.round(pos.y - 30) });
      project().apply((s) => addNode(s, node));
      project().select({ nodes: [node.id], edges: [] });
    },
    [screenToFlowPosition],
  );

  return (
    <div className="relative h-full w-full" onDragOver={(e) => (e.preventDefault(), (e.dataTransfer.dropEffect = 'move'))} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStart={() => (dragBefore.current = project().schema)}
        onNodeDragStop={() => {
          if (dragBefore.current) project().pushHistory(dragBefore.current);
          dragBefore.current = null;
        }}
        onNodeContextMenu={(e, n) => {
          e.preventDefault();
          ui().openContextMenu({ x: e.clientX, y: e.clientY, target: { type: 'node', id: n.id } });
        }}
        onEdgeContextMenu={(e, edge) => {
          e.preventDefault();
          ui().openContextMenu({ x: e.clientX, y: e.clientY, target: { type: 'edge', id: edge.id } });
        }}
        onPaneClick={() => project().setHighlight(null)}
        deleteKeyCode={null}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Control', 'Meta']}
        snapToGrid
        snapGrid={[10, 10]}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.15}
        maxZoom={2.5}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--canvas-dots)" />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => {
            const sn = project().schema.nodes.find((x) => x.id === n.id);
            return sn ? KIND_COLOR[sn.kind] : '#64748b';
          }}
          nodeStrokeWidth={0}
          style={{ width: 170, height: 110 }}
        />
        <Controls showInteractive={false} />
        {running && <FlowLayer />}
      </ReactFlow>
      {schema.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="max-w-sm rounded-xl border border-dashed border-border bg-card/60 p-6 text-center">
            <MousePointerClick className="mx-auto mb-2 size-7 text-muted-foreground" />
            <div className="font-semibold">{t('canvas.emptyTitle')}</div>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('canvas.emptyHint')}</div>
          </div>
        </div>
      )}
      <ContextMenu />
    </div>
  );
}
