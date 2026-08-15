import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
  // The build-time constants vite.config.ts substitutes. Unit tests run the
  // alpha branch, because that is the branch that has anything to test.
  define: {
    __SC_ALPHA__: 'true',
    __SC_ISSUE_URL__: '"https://example.invalid/issues/new"',
    __SC_BUILD__: '"test"',
  },
});
