import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Tests (docs/2026-11-28-automated-testing-plan.md). One file for every test
 * project: `unit` needs nothing running; `integration` (subtask 2) will add
 * the test database.
 *
 * The environment below is test-only and holds no secret, so it lives here
 * rather than in a .env file (.gitignore ignores .env*). lib/config.ts throws
 * at import on a missing required variable, and modules under test reach it
 * through lib/prisma — a unit test never connects. The URLs point at the test
 * database and Redis database 1, never the dev ones, so a test that does
 * connect by mistake cannot touch dev data or feed jobs to `npm run worker`.
 * No Claude, Resend or AI-reader credentials: those features stay "not set up".
 */
const testEnv = {
  DATABASE_URL:        process.env.TEST_DATABASE_URL ?? 'postgresql://kitchen:kitchen@localhost:5432/kitchen_erp_test?schema=public',
  REDIS_URL:           process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1',
  JWT_SECRET:          'test-only-not-a-real-secret',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  ANTHROPIC_API_KEY:   '',
  AI_DATABASE_URL:     '',
  RESEND_API_KEY:      '',
}

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
    ],
  },
})
