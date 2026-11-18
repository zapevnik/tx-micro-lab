/**
 * Хранилище текущего проекта: схема, история (отмена/повтор ≥ 50 шагов, ТЗ 5.1), выделение.
 * Все изменения схемы идут через `apply(fn)`, где fn — чистая функция из src/schema или src/features.
 */
import { create } from 'zustand';
import { emptySchema, type Schema } from '@/schema/types';
import { validateSchema, type Issue } from '@/schema/validate';

const HISTORY_LIMIT = 100;

export interface Selection {
  nodes: string[];
  edges: string[];
}

interface ProjectState {
  projectId: string | null;
  schema: Schema;
  issues: Issue[];
  past: Schema[];
  future: Schema[];
  selection: Selection;
  /** Эндпоинт, транзакция которого подсвечена на холсте (5.6). */
  highlightEndpoint: string | null;
  /** Эндпоинт, который нужно раскрыть в редакторе (переход из подсказки). */
  focusEndpoint: string | null;
  /** Номер ревизии — меняется при каждом изменении схемы, кроме перемещения узлов. */
  revision: number;

  load(projectId: string, schema: Schema): void;
  apply(fn: (s: Schema) => Schema, opts?: { history?: boolean; structural?: boolean }): void;
  /** Положить в историю снимок «до» (для перетаскивания и ползунков, которые меняют схему без истории). */
  pushHistory(before: Schema): void;
  undo(): void;
  redo(): void;
  select(sel: Partial<Selection>): void;
  setHighlight(endpointId: string | null): void;
  setFocusEndpoint(endpointId: string | null): void;
}

export const useProject = create<ProjectState>((set, get) => ({
  projectId: null,
  schema: emptySchema(''),
  issues: [],
  past: [],
  future: [],
  selection: { nodes: [], edges: [] },
  highlightEndpoint: null,
  focusEndpoint: null,
  revision: 0,

  load(projectId, schema) {
    set({
      projectId,
      schema,
      issues: validateSchema(schema),
      past: [],
      future: [],
      selection: { nodes: [], edges: [] },
      highlightEndpoint: null,
      revision: 0,
    });
  },

  apply(fn, opts = {}) {
    const { schema, past, revision } = get();
    const next = fn(schema);
    if (next === schema) return;
    const history = opts.history ?? true;
    const structural = opts.structural ?? true;
    set({
      schema: next,
      issues: structural ? validateSchema(next) : get().issues,
      past: history ? [...past.slice(-(HISTORY_LIMIT - 1)), schema] : past,
      future: history ? [] : get().future,
      revision: structural ? revision + 1 : revision,
    });
  },

  pushHistory(before) {
    const { past, schema } = get();
    if (before === schema) return;
    set({ past: [...past.slice(-(HISTORY_LIMIT - 1)), before], future: [] });
  },

  undo() {
    const { past, future, schema, revision } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({
      schema: prev,
      issues: validateSchema(prev),
      past: past.slice(0, -1),
      future: [schema, ...future],
      revision: revision + 1,
      selection: pruneSelection(get().selection, prev),
    });
  },

  redo() {
    const { past, future, schema, revision } = get();
    if (!future.length) return;
    const next = future[0];
    set({
      schema: next,
      issues: validateSchema(next),
      past: [...past, schema],
      future: future.slice(1),
      revision: revision + 1,
      selection: pruneSelection(get().selection, next),
    });
  },

  select(sel) {
    const cur = get().selection;
    set({ selection: { nodes: sel.nodes ?? cur.nodes, edges: sel.edges ?? cur.edges } });
  },

  setHighlight(endpointId) {
    set({ highlightEndpoint: endpointId });
  },

  setFocusEndpoint(endpointId) {
    set({ focusEndpoint: endpointId });
  },
}));

function pruneSelection(sel: Selection, schema: Schema): Selection {
  const nodes = new Set(schema.nodes.map((n) => n.id));
  const edges = new Set(schema.edges.map((e) => e.id));
  return { nodes: sel.nodes.filter((id) => nodes.has(id)), edges: sel.edges.filter((id) => edges.has(id)) };
}

/** Удобный доступ вне React. */
export const project = () => useProject.getState();
