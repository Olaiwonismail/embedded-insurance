import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Test files share one database and truncate the same tables, so run them one at a time.
    fileParallelism: false,
    env: {
      // Test-only values; never use these outside tests.
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      DEFAULT_COMMISSION_RATE: '0.1',
      ADMIN_API_KEY: 'test-admin-key-0123456789abcdefghijklmnop',
    },
  },
});
