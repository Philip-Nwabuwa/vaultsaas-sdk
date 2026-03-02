import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      include: [
        'src/client/**/*.ts',
        'src/errors/**/*.ts',
        'src/idempotency/**/*.ts',
        'src/router/**/*.ts',
        'src/webhooks/**/*.ts',
      ],
      exclude: ['**/index.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 90,
      },
    },
  },
});
