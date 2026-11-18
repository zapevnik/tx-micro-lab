/// <reference types="vitest/config" />
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    // Реальный движок (VITE_ENGINE=ws) по умолчанию слушает :8080; REST проксируется,
    // чтобы фронтенд и при разработке, и при встраивании в Go-бинарник ходил на относительный /api.
    proxy: {
      '/api': { target: process.env.ENGINE_URL ?? 'http://localhost:8080', changeOrigin: true, ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
