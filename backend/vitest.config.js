import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js', 'scripts/**/*.js'],
      reporter: ['text-summary', 'html', 'lcov'],
    },
  },
});
