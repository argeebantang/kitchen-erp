import { Redis } from 'ioredis'
import { z } from 'zod'
import { config } from '@/lib/config'

/**
 * Real-time "your notifications changed" signals, over Redis pub/sub.
 *
 * NODE RUNTIME ONLY, like lib/queue.ts: ioredis opens TCP sockets.
 *
 * Notifications are written by the worker (a separate process) and read by the
 * Next.js server, so the signal has to cross processes — and, in production,
 * possibly several app servers. Redis pub/sub does both: every server process
 * holds ONE subscriber connection and fans each message out to the browser
 * streams it holds for those users (app/api/notifications/stream).
 *
 * The message carries user ids only. The browser re-reads its notifications
 * from the API, so there is one read path and nothing to merge.
 *
 * Pub/sub is fire-and-forget: a server that is not listening misses the
 * message. That is fine because every stream reloads when it (re)connects.
 */

const CHANNEL = 'notifications:changed'

const MessageSchema = z.object({ userIds: z.array(z.string()) })

type Listener = () => void

type RealtimeState = {
  publisher: Redis | null
  subscriber: Promise<Redis> | null
  /** userId → the open streams for that user on this server. */
  listeners: Map<string, Set<Listener>>
}

// On globalThis for the same reason as lib/prisma.ts and lib/queue.ts: hot
// reload re-evaluates this module, and a fresh subscriber per reload would
// leak a Redis connection each time and lose the open streams' listeners.
const globalForRealtime = globalThis as unknown as { realtime: RealtimeState | undefined }
const state: RealtimeState = (globalForRealtime.realtime ??= {
  publisher:  null,
  subscriber: null,
  listeners:  new Map(),
})

/**
 * Tell every server that these users' notifications changed. Lazy, so
 * importing this file opens no connection (next build must not need Redis).
 */
export async function publishNotificationsChanged(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return
  state.publisher ??= new Redis(config.redisUrl)
  await state.publisher.publish(CHANNEL, JSON.stringify({ userIds: [...new Set(userIds)] }))
}

/**
 * Resolves once this process is subscribed. A stream awaits it before
 * answering, so no message can fall between "connected" and "listening".
 * ioredis reconnects and re-subscribes by itself if Redis drops.
 */
export function ensureSubscribed(): Promise<Redis> {
  state.subscriber ??= (async () => {
    const subscriber = new Redis(config.redisUrl)
    subscriber.on('message', (_channel: string, raw: string) => {
      let parsed
      try {
        parsed = MessageSchema.safeParse(JSON.parse(raw))
      } catch {
        return // not JSON — nothing anyone here published
      }
      if (!parsed.success) return
      for (const userId of parsed.data.userIds) {
        state.listeners.get(userId)?.forEach(listener => listener())
      }
    })
    await subscriber.subscribe(CHANNEL)
    return subscriber
  })().catch(err => {
    state.subscriber = null // let the next stream try again rather than keep a failed promise
    throw err
  })
  return state.subscriber
}

/** Call `listener` whenever this user's notifications change. Returns the unsubscribe. */
export function onNotificationsChanged(userId: string, listener: Listener): () => void {
  const set = state.listeners.get(userId) ?? new Set<Listener>()
  set.add(listener)
  state.listeners.set(userId, set)

  return () => {
    set.delete(listener)
    if (set.size === 0) state.listeners.delete(userId)
  }
}
