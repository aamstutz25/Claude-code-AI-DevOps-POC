import { defineConfig } from 'vitest/config';

// Runs against the real SQL Server configured in .env. Requires `npm run db:migrate` first.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/integration/**/*.test.js'],
    testTimeout: 30_000,
  },
});
