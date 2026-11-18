import { defineConfig } from '@playwright/test';

const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  workers: 2,
  use: { baseURL: external ?? 'http://localhost:5173', viewport: { width: 1600, height: 950 } },
  webServer: external ? undefined : { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true },
});
