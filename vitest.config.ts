import { defineConfig } from 'vitest/config';

// Tests run against their own database so they never touch dev data.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5434/ledger_test';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20_000,
    env: { DATABASE_URL: TEST_DATABASE_URL, NODE_ENV: 'test' },
    globalSetup: ['tests/globalSetup.ts'],
    // Integration tests share one database; run files one at a time.
    fileParallelism: false,
  },
});
