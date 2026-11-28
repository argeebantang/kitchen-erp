import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

/**
 * The environment every test runs with (docs/2026-11-28-automated-testing-plan.md).
 * Shared by vitest.config.ts (handed to the test workers) and the integration
 * global setup (which runs `prisma migrate reset` before any worker starts).
 *
 * Database and Redis come from, in order:
 *   1. TEST_DATABASE_URL / TEST_REDIS_URL — CI sets these.
 *   2. Your .env's DATABASE_URL / REDIS_URL, pointed elsewhere: the database
 *      name gets "_test" appended, Redis moves to database 1. Same server,
 *      same credentials, nothing to configure locally.
 *   3. The docker-compose defaults, for a checkout without a .env.
 * Only those two variables are read from .env — never its API keys.
 */

function fromDotEnv(key: string): string | undefined {
  const file = new URL('../../.env', import.meta.url)
  if (!existsSync(file)) return undefined
  return parseEnv(readFileSync(file, 'utf8'))[key]
}

function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL
  const url = new URL(fromDotEnv('DATABASE_URL') ?? 'postgresql://kitchen:kitchen@localhost:5432/kitchen_erp?schema=public')
  const name = url.pathname.slice(1)
  if (!name.endsWith('_test')) url.pathname = `/${name}_test`
  return url.toString()
}

function testRedisUrl(): string {
  if (process.env.TEST_REDIS_URL) return process.env.TEST_REDIS_URL
  const url = new URL(fromDotEnv('REDIS_URL') ?? 'redis://localhost:6379')
  url.pathname = '/1'
  return url.toString()
}

/** No Claude, Resend or AI-reader credentials: those features stay "not set up". */
export const testEnv = {
  DATABASE_URL:        testDatabaseUrl(),
  REDIS_URL:           testRedisUrl(),
  JWT_SECRET:          'test-only-not-a-real-secret',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  ANTHROPIC_API_KEY:   '',
  AI_DATABASE_URL:     '',
  RESEND_API_KEY:      '',
}

/** The database a URL names, e.g. "kitchen_erp_test". */
export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1))
}

/**
 * Integration tests wipe the database. Refuse anything not named *_test, so a
 * wrong TEST_DATABASE_URL can never reach the dev data.
 */
export function assertTestDatabase(url: string): void {
  const name = databaseName(url)
  if (!name.endsWith('_test')) {
    throw new Error(`[tests] Refusing to use database "${name}": integration tests wipe it, so its name must end in _test.`)
  }
}

/**
 * Integration tests flush their Redis database. Refuse database 0 — the one
 * `npm run dev` and `npm run worker` use.
 */
export function assertTestRedis(url: string): void {
  const db = Number(new URL(url).pathname.slice(1) || '0')
  if (!Number.isInteger(db) || db < 1) {
    throw new Error(`[tests] Refusing Redis database ${new URL(url).pathname.slice(1) || '0'}: use 1 or above (redis://host:6379/1); 0 is the app's own.`)
  }
}
