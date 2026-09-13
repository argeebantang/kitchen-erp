import { Queue, type ConnectionOptions } from 'bullmq'
import { config } from '@/lib/config'

/**
 * Redis-backed job queues — PRODUCER side only.
 *
 * NODE RUNTIME ONLY. ioredis opens a TCP socket, which the Edge runtime cannot
 * do. Importing this from middleware.ts or a Client Component reproduces the
 * bcrypt-in-Edge failure from Week 2 exactly: it compiles, it works in
 * `next dev`, and every request 500s in production.
 *
 * A BullMQ Worker cannot run inside Next.js — it needs a long-lived process —
 * so the consumer lives in worker/, which nothing under app/ imports.
 */

export const NOTIFICATIONS_QUEUE = 'notifications'

/** Job name within the queue. */
export const PR_SUBMITTED = 'pr-submitted'

/**
 * An id, not the purchase request itself. The worker re-reads from the database
 * when it runs, so it always acts on current data. A snapshot in the payload
 * would be a second source of truth, already stale by the time the job is
 * picked up.
 */
export type PrSubmittedJob = {
  purchaseRequestId: string
}

/**
 * maxRetriesPerRequest must be null: BullMQ manages its own retries and refuses
 * to start against a connection configured to give up on its own.
 */
/**
 * Connection settings, shared by the producer here and the worker in worker/.
 *
 * Options rather than a client instance, and that is not a style choice.
 * Passing `new IORedis(...)` does not compile: bullmq pins its own copy of
 * ioredis (5.10.1) alongside the project's (5.11.1), and TypeScript treats the
 * two Redis classes as different types even though they behave identically at
 * runtime. Handing over options lets bullmq construct the client with its own
 * copy, so the mismatch cannot occur.
 *
 * maxRetriesPerRequest must be null: BullMQ manages its own retries and refuses
 * to start against a connection configured to give up on its own.
 */
export const redisConnection: ConnectionOptions = {
  url: config.redisUrl,
  maxRetriesPerRequest: null,
}


// Cached on globalThis for the same reason lib/prisma.ts is: Next re-evaluates
// modules on hot reload, and a new Queue per reload would leak a Redis socket
// each time until the process runs out.
const globalForQueue = globalThis as unknown as {
  notificationQueue: Queue | undefined
}

/**
 * Lazy on purpose. Constructing the Queue at module top level would open a
 * Redis connection the moment this file is imported — including during
 * `next build`, which evaluates modules and would then require Redis to be
 * running just to compile.
 */
export function getNotificationQueue(): Queue {
  if (!globalForQueue.notificationQueue) {
    globalForQueue.notificationQueue = new Queue(NOTIFICATIONS_QUEUE, {
      connection: redisConnection,
    })
  }
  return globalForQueue.notificationQueue
}
