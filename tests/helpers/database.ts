import Redis from 'ioredis'
import type { Queue } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { assertTestDatabase, assertTestRedis, testEnv } from './test-env'

/**
 * Test-only database plumbing. The one place outside repositories/ that
 * imports lib/prisma (docs/coding-conventions.md, "Tests"): emptying tables
 * and closing connections are not app operations.
 */

let tables: string[] | null = null
let redis: Redis | null = null

/**
 * Empty every table, so each test starts from nothing and builds its own
 * world (fixtures.ts). Checks the connected database by name first — the
 * guard is on what Postgres says, not on what the URL claimed.
 */
export async function resetDatabase(): Promise<void> {
  if (!tables) {
    const [{ name }] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`
    assertTestDatabase(`postgresql://localhost/${name}`)
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
    tables = rows.map(row => `"public"."${row.tablename}"`)
  }
  // One statement, CASCADE: order does not matter and foreign keys cannot block it.
  if (tables.length > 0) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`)

  // Jobs the last test queued (notifications, emails) go too.
  assertTestRedis(testEnv.REDIS_URL)
  redis ??= new Redis(testEnv.REDIS_URL, { maxRetriesPerRequest: 1 })
  await redis.flushdb()
}

/**
 * Close every connection a test file opened, or Vitest waits on open sockets.
 * The queues and the realtime publisher are lazy singletons on globalThis
 * (lib/queue.ts, lib/realtime.ts); they exist only if a test used them.
 */
export async function closeConnections(): Promise<void> {
  const queues = globalThis as unknown as Record<'notificationQueue' | 'aiQueue' | 'emailQueue', Queue | undefined>
  await Promise.all([queues.notificationQueue, queues.aiQueue, queues.emailQueue].map(queue => queue?.close()))

  const realtime = (globalThis as unknown as { realtime?: { publisher: Redis | null } }).realtime
  realtime?.publisher?.disconnect()

  redis?.disconnect()
  redis = null
  await prisma.$disconnect()
}
