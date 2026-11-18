/**
 * Реализация EngineClient для настоящего Go-движка: WebSocket для интерактивного запуска (6.3),
 * REST для разовых операций (6.2).
 *
 * - Каждое входящее сообщение проверяется Zod-схемой; некорректные отбрасываются с ошибкой в консоль.
 * - При обрыве соединения — статус `reconnecting` и повторные попытки с экспоненциальной задержкой
 *   (ТЗ 7, «Надёжность»). Команды, отправленные без соединения, копятся в очереди.
 */
import type { Schema } from '@/schema/types';
import {
  EngineMessage,
  type ConnectionStatus,
  type EngineClient,
  type EngineCommand,
  type ExperimentConfig,
  type ExperimentProgress,
  type ExperimentReport,
  type MessageListener,
  type StatusListener,
  type TemplateInfo,
  type ValidateResponse,
} from '../types';

const MAX_BACKOFF_MS = 10_000;

export class WsEngineClient implements EngineClient {
  readonly kind = 'ws' as const;
  private ws: WebSocket | null = null;
  private listeners = new Set<MessageListener>();
  private statusListeners = new Set<StatusListener>();
  private current: ConnectionStatus = 'closed';
  private queue: EngineCommand[] = [];
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly baseUrl: string) {
    this.connect();
  }

  private wsUrl(): string {
    const base = this.baseUrl || window.location.origin;
    return base.replace(/^http/, 'ws') + '/api/ws';
  }

  private setStatus(s: ConnectionStatus) {
    this.current = s;
    for (const l of this.statusListeners) l(s);
  }

  private connect() {
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocket(this.wsUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.setStatus('open');
      for (const cmd of this.queue.splice(0)) ws.send(JSON.stringify(cmd));
    };
    ws.onmessage = (ev) => {
      let data: unknown;
      try {
        data = JSON.parse(String(ev.data));
      } catch {
        console.error('[engine] не JSON', ev.data);
        return;
      }
      const parsed = EngineMessage.safeParse(data);
      if (!parsed.success) {
        console.error('[engine] сообщение не соответствует контракту', parsed.error.issues[0], data);
        return;
      }
      for (const l of this.listeners) l(parsed.data);
    };
    ws.onclose = () => {
      this.ws = null;
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.attempt += 1;
    this.setStatus('reconnecting');
    const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** Math.min(this.attempt, 5));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  send(cmd: EngineCommand): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(cmd));
    else this.queue.push(cmd);
  }

  onMessage(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.current);
    return () => this.statusListeners.delete(listener);
  }

  status(): ConnectionStatus {
    return this.current;
  }

  /* ---------------- REST ---------------- */

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  validate(schema: Schema): Promise<ValidateResponse> {
    return this.request('POST', '/api/validate', schema);
  }

  listTemplates(): Promise<TemplateInfo[]> {
    return this.request('GET', '/api/templates');
  }

  getTemplate(id: string): Promise<Schema> {
    return this.request('GET', `/api/templates/${encodeURIComponent(id)}`);
  }

  createExperiment(config: ExperimentConfig): Promise<{ id: string }> {
    return this.request('POST', '/api/experiments', config);
  }

  getExperiment(id: string): Promise<ExperimentProgress> {
    return this.request('GET', `/api/experiments/${encodeURIComponent(id)}`);
  }

  getReport(id: string): Promise<ExperimentReport> {
    return this.request('GET', `/api/experiments/${encodeURIComponent(id)}/report`);
  }

  cancelExperiment(id: string): Promise<void> {
    return this.request('DELETE', `/api/experiments/${encodeURIComponent(id)}`);
  }
}
