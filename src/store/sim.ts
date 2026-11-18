/**
 * Состояние запуска: статус, последние метрики, история за 60 с виртуального времени,
 * подсказки, журнал, трассы, активные отказы. Наполняется контроллером из потока движка.
 * Обработка tick должна укладываться в 16 мс (ТЗ 7) — поэтому история хранится плоскими
 * массивами фиксированной длины, без пересчёта.
 */
import { create } from 'zustand';
import type {
  AlertMsg,
  ConnectionStatus,
  EdgeMetrics,
  GlobalMetrics,
  NodeMetrics,
  TickMsg,
  TraceMsg,
  TxSummary,
} from '@/engine/types';
import type { FaultAction } from '@/schema/types';

export const WINDOW_S = 60;

export type RunStatus = 'idle' | 'running' | 'paused';

export interface GlobalPoint extends GlobalMetrics {
  t: number;
}

export interface NodePoint {
  t: number;
  load: number;
  rps: number;
  p50: number;
  p99: number;
  queue: number;
  locks: number;
  errors: number;
}

export interface Marker {
  t: number;
  label: string;
}

export type LogKind = 'alert' | 'resolved' | 'violation' | 'change' | 'run' | 'fault' | 'error';

export interface LogEntry {
  id: number;
  t: number;
  kind: LogKind;
  text: string;
  nodeId?: string;
}

export interface ActiveFault {
  id: string;
  action: FaultAction;
}

interface SimState {
  status: RunStatus;
  connection: ConnectionStatus;
  speed: number;
  t: number;
  nodes: Record<string, NodeMetrics>;
  edges: Record<string, EdgeMetrics>;
  global: GlobalMetrics | null;
  history: GlobalPoint[];
  /** Полная история запуска — для экспорта в CSV (5.12). */
  fullHistory: GlobalPoint[];
  nodeHistory: Record<string, NodePoint[]>;
  markers: Marker[];
  alerts: Record<string, AlertMsg>;
  dismissed: Record<string, true>;
  log: LogEntry[];
  recentTx: TxSummary[];
  traces: Record<string, TraceMsg>;
  faults: Record<string, ActiveFault>;
  violationsTotal: number;

  setStatus(s: RunStatus): void;
  setConnection(c: ConnectionStatus): void;
  setSpeed(s: number): void;
  reset(): void;
  applyTick(msg: TickMsg): void;
  setAlert(msg: AlertMsg): void;
  dismissAlert(key: string): void;
  undismissAlert(key: string): void;
  addLog(kind: LogKind, text: string, nodeId?: string): void;
  clearLog(): void;
  addMarker(label: string): void;
  setTrace(msg: TraceMsg): void;
  setFault(f: ActiveFault): void;
  removeFault(id: string): void;
}

let logSeq = 0;

export const alertKey = (a: { code: string; nodeId: string }) => `${a.code}|${a.nodeId}`;

const runData = () => ({
  t: 0,
  nodes: {},
  edges: {},
  global: null,
  history: [],
  fullHistory: [],
  nodeHistory: {},
  markers: [],
  alerts: {},
  dismissed: {},
  recentTx: [],
  traces: {},
  violationsTotal: 0,
});

export const useSim = create<SimState>((set, get) => ({
  status: 'idle',
  connection: 'open',
  speed: 1,
  log: [],
  faults: {},
  ...runData(),

  setStatus: (status) => set({ status }),
  setConnection: (connection) => set({ connection }),
  setSpeed: (speed) => set({ speed }),
  reset: () => set(runData()),

  applyTick(msg) {
    const s = get();
    const point: GlobalPoint = { t: msg.t, ...msg.global };
    const from = msg.t - WINDOW_S;
    const history = trimWindow([...s.history, point], from);
    const nodeHistory: Record<string, NodePoint[]> = {};
    for (const [id, m] of Object.entries(msg.nodes)) {
      const prev = s.nodeHistory[id] ?? [];
      nodeHistory[id] = trimWindow(
        [
          ...prev,
          { t: msg.t, load: m.load * 100, rps: m.rps, p50: m.p50, p99: m.p99, queue: m.queue, locks: m.locks ?? 0, errors: m.errorsPerS },
        ],
        from,
      );
    }
    const recentTx = msg.recentTx?.length ? [...msg.recentTx.slice().reverse(), ...s.recentTx].slice(0, 200) : s.recentTx;
    set({
      t: msg.t,
      nodes: msg.nodes,
      edges: msg.edges,
      global: msg.global,
      history,
      fullHistory: [...s.fullHistory, point],
      nodeHistory,
      recentTx,
      violationsTotal: msg.global.violationsTotal,
      markers: s.markers.filter((m) => m.t >= from),
    });
  },

  setAlert(msg) {
    const key = alertKey(msg);
    const alerts = { ...get().alerts };
    if (msg.active) alerts[key] = msg;
    else delete alerts[key];
    set({ alerts });
  },

  dismissAlert(key) {
    set({ dismissed: { ...get().dismissed, [key]: true } });
  },

  undismissAlert(key) {
    if (!get().dismissed[key]) return;
    const dismissed = { ...get().dismissed };
    delete dismissed[key];
    set({ dismissed });
  },

  addLog(kind, text, nodeId) {
    const entry: LogEntry = { id: ++logSeq, t: get().t, kind, text, nodeId };
    set({ log: [entry, ...get().log].slice(0, 500) });
  },

  clearLog: () => set({ log: [] }),

  addMarker(label) {
    set({ markers: [...get().markers, { t: get().t, label }] });
  },

  setTrace(msg) {
    set({ traces: { ...get().traces, [msg.txId]: msg } });
  },

  setFault(f) {
    set({ faults: { ...get().faults, [f.id]: f } });
  },

  removeFault(id) {
    const faults = { ...get().faults };
    delete faults[id];
    set({ faults });
  },
}));

function trimWindow<T extends { t: number }>(arr: T[], from: number): T[] {
  let i = 0;
  while (i < arr.length && arr[i].t < from) i++;
  return i ? arr.slice(i) : arr;
}

export const sim = () => useSim.getState();
