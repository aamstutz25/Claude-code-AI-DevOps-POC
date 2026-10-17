import { defineConfig, devices } from '@playwright/test';

// Browser test of the production build: Express serves the React app and the API on one
// port, backed by the database configured in .env. Run `npm run build` first.
const port = process.env.E2E_PORT ?? '3198';

export default defineConfig({
  testDir: '.',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]]
    : 'list',
  outputDir: '../test-results',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node ../backend/src/server.js',
    env: { PORT: port },
    url: `http://localhost:${port}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
