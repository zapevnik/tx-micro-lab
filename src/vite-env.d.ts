/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENGINE?: 'mock' | 'ws';
  readonly VITE_ENGINE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
