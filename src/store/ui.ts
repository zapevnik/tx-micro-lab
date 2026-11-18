/**
 * Состояние интерфейса: панели, вкладки, настройки отображения, диалоги, уведомления.
 * Личные настройки (анимация, подсказки, пороги) запоминаются в localStorage.
 */
import { create } from 'zustand';

export type BottomTab = 'metrics' | 'tracing' | 'log' | 'tasks';
export type PropsTab = 'params' | 'endpoints' | 'metrics' | 'load';
export type ScaleDialog = { kind: 'shard' | 'replicate' | 'partition'; dbId: string } | null;

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'error' | 'warn';
}

export interface ContextMenuState {
  x: number;
  y: number;
  target: { type: 'node'; id: string } | { type: 'edge'; id: string };
}

export interface PromptState {
  title: string;
  label: string;
  value: string;
  onSubmit: (value: string) => void;
}

export interface ConfirmState {
  text: string;
  onConfirm: () => void;
}

interface Prefs {
  animation: boolean;
  hints: boolean;
  warnAt: number;
  critAt: number;
}

interface UiState extends Prefs {
  bottomTab: BottomTab;
  propsTab: PropsTab;
  scaleDialog: ScaleDialog;
  contextMenu: ContextMenuState | null;
  prompt: PromptState | null;
  confirm: ConfirmState | null;
  /** Предупреждение после шардирования: транзакции стали кросс-шардовыми (5.4, сценарий 2). */
  shardWarning: { dbId: string; endpointIds: string[] } | null;
  toasts: Toast[];
  setShardWarning(w: { dbId: string; endpointIds: string[] } | null): void;
  setPrefs(p: Partial<Prefs>): void;
  setBottomTab(t: BottomTab): void;
  setPropsTab(t: PropsTab): void;
  openScale(d: ScaleDialog): void;
  openContextMenu(m: ContextMenuState | null): void;
  ask(p: PromptState | null): void;
  askConfirm(c: ConfirmState | null): void;
  toast(text: string, tone?: Toast['tone']): void;
  dropToast(id: number): void;
}

const PREFS_KEY = 'dtx.prefs';
const defaults: Prefs = { animation: true, hints: true, warnAt: 0.7, critAt: 0.9 };

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<Prefs>) } : defaults;
  } catch {
    return defaults;
  }
}

let toastSeq = 0;

export const useUi = create<UiState>((set, get) => ({
  ...loadPrefs(),
  bottomTab: 'metrics',
  propsTab: 'params',
  scaleDialog: null,
  contextMenu: null,
  prompt: null,
  confirm: null,
  shardWarning: null,
  toasts: [],
  setShardWarning: (shardWarning) => set({ shardWarning }),

  setPrefs(p) {
    set(p);
    const { animation, hints, warnAt, critAt } = get();
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ animation, hints, warnAt, critAt }));
    } catch {
      /* приватный режим — настройки просто не запомнятся */
    }
  },
  setBottomTab: (bottomTab) => set({ bottomTab }),
  setPropsTab: (propsTab) => set({ propsTab }),
  openScale: (scaleDialog) => set({ scaleDialog }),
  openContextMenu: (contextMenu) => set({ contextMenu }),
  ask: (prompt) => set({ prompt }),
  askConfirm: (confirm) => set({ confirm }),
  toast(text, tone = 'info') {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts.slice(-3), { id, text, tone }] });
    setTimeout(() => get().dropToast(id), tone === 'error' ? 6000 : 3500);
  },
  dropToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const ui = () => useUi.getState();

/** Уровень состояния узла по загрузке (5.9): пороги настраиваются. */
export function loadLevel(load: number, queueGrowing: boolean, warnAt: number, critAt: number): 'ok' | 'warn' | 'crit' {
  if (load > critAt || queueGrowing) return 'crit';
  if (load >= warnAt) return 'warn';
  return 'ok';
}
