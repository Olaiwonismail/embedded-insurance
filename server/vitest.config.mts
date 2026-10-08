import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    env: {
      // Test-only values; never use these outside tests.
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      DEFAULT_COMMISSION_RATE: '0.1',
    },
  },
});
