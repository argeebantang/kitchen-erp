import { Redis } from 'ioredis'
import { z } from 'zod'
import { config } from '@/lib/config'

/**
 * Real-time signals over Redis pub/sub: "your notifications changed", and
 * "this branch's stock changed" for Branch Inventory (Week 8 Task 5).
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
const INVENTORY_CHANNEL = 'inventory:changed'

const MessageSchema = z.object({ userIds: z.array(z.string()) })
const InventoryMessageSchema = z.object({ branchIds: z.array(z.string()) })

/** The inventory listener key for "any branch" — the Branch Inventory index. */
const ANY_BRANCH = '*'

type Listener = () => void

type RealtimeState = {
  publisher: Redis | null
  subscriber: Promise<Redis> | null
  /** userId → the open streams for that user on this server. */
  listeners: Map<string, Set<Listener>>
  /** branchId (or ANY_BRANCH) → the open inventory streams watching it. */
  inventoryListeners: Map<string, Set<Listener>>
}

// On globalThis for the same reason as lib/prisma.ts and lib/queue.ts: hot
// reload re-evaluates this module, and a fresh subscriber per reload would
// leak a Redis connection each time and lose the open streams' listeners.
const globalForRealtime = globalThis as unknown as { realtime: RealtimeState | undefined }
const state: RealtimeState = (globalForRealtime.realtime ??= {
  publisher:  null,
  subscriber: null,
  listeners:  new Map(),
  inventoryListeners: new Map(),
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
    subscriber.on('message', (channel: string, raw: string) => {
      let data: unknown
      try {
        data = JSON.parse(raw)
      } catch {
        return // not JSON — nothing anyone here published
      }
      if (channel === CHANNEL) {
        const parsed = MessageSchema.safeParse(data)
        if (!parsed.success) return
        for (const userId of parsed.data.userIds) {
          state.listeners.get(userId)?.forEach(listener => listener())
        }
      } else if (channel === INVENTORY_CHANNEL) {
        const parsed = InventoryMessageSchema.safeParse(data)
        if (!parsed.success) return
        // A Set, so a stream watching two of the branches still hears it once.
        const due = new Set<Listener>()
        for (const key of [...parsed.data.branchIds, ANY_BRANCH]) {
          state.inventoryListeners.get(key)?.forEach(listener => due.add(listener))
        }
        due.forEach(listener => listener())
      }
    })
    await subscriber.subscribe(CHANNEL, INVENTORY_CHANNEL)
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

/**
 * Tell every server that stock at these branches changed (Week 8 Task 5) —
 * called by the services after the commit that moved it. Fire-and-forget: the
 * change is already saved, so a Redis hiccup must not fail the request; open
 * pages catch up on their 2-minute refresh.
 */
export function signalInventoryChanged(branchIds: string[]): void {
  const ids = [...new Set(branchIds)]
  if (ids.length === 0) return
  state.publisher ??= new Redis(config.redisUrl)
  state.publisher.publish(INVENTORY_CHANNEL, JSON.stringify({ branchIds: ids })).catch(err => {
    console.error('[realtime] inventory signal not sent', err)
  })
}

/**
 * Call `listener` whenever stock at this branch changes — or at any branch
 * when `branchId` is null. Returns the unsubscribe.
 */
export function onInventoryChanged(branchId: string | null, listener: Listener): () => void {
  const key = branchId ?? ANY_BRANCH
  const set = state.inventoryListeners.get(key) ?? new Set<Listener>()
  set.add(listener)
  state.inventoryListeners.set(key, set)

  return () => {
    set.delete(listener)
    if (set.size === 0) state.inventoryListeners.delete(key)
  }
}
