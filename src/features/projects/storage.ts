/**
 * Хранение проектов и отчётов в браузере (IndexedDB, ТЗ 5.15).
 * Доступ — только через интерфейсы репозиториев: если позже проекты переедут на сервер,
 * достаточно написать REST-реализацию с теми же методами.
 */
import type { ExperimentReport } from '@/engine/types';
import type { Schema } from '@/schema/types';

export interface ProjectRecord {
  id: string;
  name: string;
  updatedAt: number;
  schema: Schema;
}

export interface ProjectRepository {
  list(): Promise<ProjectRecord[]>;
  get(id: string): Promise<ProjectRecord | undefined>;
  put(rec: ProjectRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface ReportRecord {
  id: string;
  projectId: string;
  report: ExperimentReport;
}

export interface ReportRepository {
  list(projectId?: string): Promise<ReportRecord[]>;
  put(rec: ReportRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

const DB_NAME = 'dtx-sandbox';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('reports')) db.createObjectStore('reports', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(store, mode).objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const idbProjects: ProjectRepository = {
  async list() {
    const all = await tx<ProjectRecord[]>('projects', 'readonly', (s) => s.getAll());
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  },
  get: (id) => tx<ProjectRecord | undefined>('projects', 'readonly', (s) => s.get(id)),
  put: (rec) => tx('projects', 'readwrite', (s) => s.put(rec)).then(() => undefined),
  remove: (id) => tx('projects', 'readwrite', (s) => s.delete(id)).then(() => undefined),
};

export const idbReports: ReportRepository = {
  async list(projectId) {
    const all = await tx<ReportRecord[]>('reports', 'readonly', (s) => s.getAll());
    return all
      .filter((r) => !projectId || r.projectId === projectId)
      .sort((a, b) => b.report.createdAt.localeCompare(a.report.createdAt));
  },
  put: (rec) => tx('reports', 'readwrite', (s) => s.put(rec)).then(() => undefined),
  remove: (id) => tx('reports', 'readwrite', (s) => s.delete(id)).then(() => undefined),
};

export const projectsRepo: ProjectRepository = idbProjects;
export const reportsRepo: ReportRepository = idbReports;

export function newProjectId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
