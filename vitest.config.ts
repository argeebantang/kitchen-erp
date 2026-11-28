import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { testEnv } from './tests/helpers/test-env'

/**
 * Tests (docs/2026-11-28-automated-testing-plan.md), two projects:
 *   unit        — pure functions, nothing running
 *   integration — services against a real Postgres + Redis (docker compose up)
 *
 * The environment (tests/helpers/test-env.ts) is test-only and holds no
 * secret: the test database (*_test) and Redis database 1, never the dev
 * ones, and no Claude, Resend or AI-reader keys. lib/config.ts throws at
 * import on a missing required variable, so unit tests get it too.
 */
export default defineConfig({
  // The tsconfig "@/*" path: '@' matches only "@/…", never "@prisma/client".
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    environment: 'node',
    env: testEnv,
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/helpers/global-setup.ts'],
          setupFiles: ['tests/helpers/integration-setup.ts'],
          // One database for all files: run them one at a time, or one file's
          // truncate would wipe another's rows mid-test.
          fileParallelism: false,
          // Transactions with row locks are slower than pure functions.
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
})
