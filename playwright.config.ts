import { defineConfig } from '@playwright/test';

export const API_PORT = 3100;
export const FIXTURE_PORT = 4173;

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:test@localhost:55432/insurance_test';

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',

  use: {
    // The fixture page is served from localhost on a different port to the API, so the
    // widget's call is cross-origin and goes through the real preflight.
    baseURL: `http://localhost:${FIXTURE_PORT}`,
    // Unset, Playwright uses its own chromium build. Set PLAYWRIGHT_CHANNEL=msedge to
    // drive a browser already installed on the machine instead.
    channel: process.env.PLAYWRIGHT_CHANNEL,
  },

  webServer: [
    {
      command: 'npx tsx src/index.ts',
      cwd: 'server',
      port: API_PORT,
      env: {
        PORT: String(API_PORT),
        DATABASE_URL: TEST_DATABASE_URL,
        // Test-only values; never use these outside tests.
        ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
        DEFAULT_COMMISSION_RATE: '0.1',
      },
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
    },
    {
      command: `node e2e/serve-fixture.mjs ${FIXTURE_PORT}`,
      port: FIXTURE_PORT,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
