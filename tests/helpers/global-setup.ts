import { execFileSync } from 'node:child_process'
import Redis from 'ioredis'
import { assertTestDatabase, assertTestRedis, databaseName, testEnv } from './test-env'

/**
 * Runs once before the integration tests, in Vitest's main process: checks
 * Redis is up, empties the test Redis database, and rebuilds the test
 * database from the migrations — the same ones production applies, so a
 * test never runs against a schema the app does not have.
 */
export default async function setup(): Promise<void> {
  assertTestDatabase(testEnv.DATABASE_URL)
  assertTestRedis(testEnv.REDIS_URL)

  const redis = new Redis(testEnv.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null })
  try {
    await redis.connect()
    await redis.flushdb()
  } catch (err) {
    throw new Error(`[tests] Redis is not reachable at ${testEnv.REDIS_URL} — start it with: docker compose up -d\n${String(err)}`)
  } finally {
    redis.disconnect()
  }

  // Creates the database if it is missing, drops everything, applies every migration.
  try {
    execFileSync('npx', ['prisma', 'migrate', 'reset', '--force', '--skip-seed', '--skip-generate'], {
      env: { ...process.env, DATABASE_URL: testEnv.DATABASE_URL },
      stdio: 'pipe',
      encoding: 'utf8',
    })
  } catch (err) {
    const output = err instanceof Error && 'stderr' in err ? String((err as { stderr: unknown }).stderr) : String(err)
    throw new Error(`[tests] Could not rebuild ${databaseName(testEnv.DATABASE_URL)} — is Postgres up (docker compose up -d)?\n${output}`)
  }
}
