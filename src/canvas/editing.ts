/** Действия редактирования холста: удаление с подтверждением, копирование и вставка (5.1, 5.8). */
import { t } from '@/i18n';
import { extractFragment, pasteFragment, removeEdges, removeNodes, type Fragment } from '@/schema/ops';
import { project } from '@/store/project';
import { sim } from '@/store/sim';
import { ui } from '@/store/ui';

let clipboard: Fragment | null = null;
let pasteCount = 0;

export function copySelection(ids = project().selection.nodes) {
  const schema = project().schema;
  const own = ids.filter((id) => !schema.nodes.find((n) => n.id === id)?.role);
  if (!own.length) return;
  clipboard = extractFragment(schema, own);
  pasteCount = 0;
}

export function paste() {
  if (!clipboard) return;
  pasteCount += 1;
  const frag = clipboard;
  let ids: string[] = [];
  project().apply((s) => {
    const r = pasteFragment(s, frag, { x: 40 * pasteCount, y: 40 * pasteCount }, (n) => `${n} ${t('canvas.copySuffix')}`);
    ids = r.ids;
    return r.schema;
  });
  project().select({ nodes: ids, edges: [] });
}

/** Удаление узлов и связей. Если через них идёт трафик — нужно подтверждение (5.8). */
export function deleteElements(nodeIds: string[], edgeIds: string[]) {
  const schema = project().schema;
  const nodes = nodeIds.filter((id) => !schema.nodes.find((n) => n.id === id)?.role);
  const edges = edgeIds.filter((id) => schema.edges.find((e) => e.id === id)?.kind === 'call');
  if (!nodes.length && !edges.length) return;
  const doIt = () => {
    project().apply((s) => removeEdges(removeNodes(s, nodes), edges));
    project().select({ nodes: [], edges: [] });
  };
  const st = sim();
  const hasTraffic =
    st.status !== 'idle' &&
    (nodes.some((id) => (st.nodes[id]?.rps ?? 0) > 0) || edges.some((id) => (st.edges[id]?.rps ?? 0) > 0));
  if (hasTraffic) ui().askConfirm({ text: t('canvas.deleteTrafficConfirm'), onConfirm: doIt });
  else doIt();
}
