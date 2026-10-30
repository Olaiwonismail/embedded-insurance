import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'https://shop.example.com/products/iphone-15' } },
    setupFiles: ['test/setup.ts'],
  },
});
