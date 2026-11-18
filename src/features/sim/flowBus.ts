/**
 * Шина точек-запросов для анимации. Сообщения `flows` идут мимо Zustand напрямую в слой
 * Canvas 2D, чтобы сотни точек не вызывали перерисовку React-компонентов.
 */
import type { FlowItem } from '@/engine/types';

type Listener = (items: FlowItem[]) => void;
const listeners = new Set<Listener>();

export const flowBus = {
  emit(items: FlowItem[]) {
    for (const l of listeners) l(items);
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
