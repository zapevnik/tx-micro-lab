/**
 * Выбор реализации движка: VITE_ENGINE=mock (по умолчанию) или ws.
 * Остальной код получает клиент только через `getEngine()` и не знает, какой он.
 */
import { MockEngineClient } from './mock/MockEngineClient';
import type { EngineClient } from './types';
import { WsEngineClient } from './ws/WsEngineClient';

let instance: EngineClient | null = null;

export function getEngine(): EngineClient {
  if (!instance) {
    const mode = import.meta.env.VITE_ENGINE ?? 'mock';
    instance = mode === 'ws' ? new WsEngineClient(import.meta.env.VITE_ENGINE_URL ?? '') : new MockEngineClient();
  }
  return instance;
}

/** Для тестов: подставить свою реализацию. */
export function setEngine(client: EngineClient): void {
  instance = client;
}

export type * from './types';
