import { NextRequest, NextResponse } from 'next/server'
import { ensureSubscribed, onNotificationsChanged } from '@/lib/realtime'

/**
 * Server-Sent Events: one long-lived response per open tab, carrying a
 * `notifications` event whenever the signed-in user's notifications change.
 * The browser's EventSource (hooks/useNotifications.ts) reloads the list on
 * each event; the event itself carries nothing.
 *
 * Needs a long-running Node server — it holds the response open — so not the
 * Edge runtime, and never cached.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Comment lines keep proxies and load balancers from closing an idle stream. */
const HEARTBEAT_MS = 25_000
/** How long EventSource waits before reconnecting after a drop. */
const RETRY_MS = 5_000

export async function GET(req: NextRequest) {
  const userId = req.headers.get('x-user-id')
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await ensureSubscribed()
  } catch (err) {
    // 503 is not an event stream, so EventSource gives up and the hook's own
    // backoff retries — the bell still works, just without live updates.
    console.error('[GET /api/notifications/stream] Redis unavailable', err)
    return NextResponse.json({ error: 'Live updates unavailable' }, { status: 503 })
  }

  const encoder = new TextEncoder()
  let close = () => {}

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const send = (text: string) => {
        if (!closed) controller.enqueue(encoder.encode(text))
      }

      const unsubscribe = onNotificationsChanged(userId, () => send('event: notifications\ndata: {}\n\n'))
      const heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS)

      close = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        unsubscribe()
        try {
          controller.close()
        } catch {
          // already closed by the runtime
        }
      }
      // The tab closed, navigated away or EventSource.close() was called.
      req.signal.addEventListener('abort', close)

      send(`retry: ${RETRY_MS}\n: connected\n\n`)
    },
    cancel() {
      close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':      'text/event-stream; charset=utf-8',
      // no-transform: stops compression middleware buffering the stream.
      'Cache-Control':     'no-cache, no-transform',
      Connection:          'keep-alive',
      // Tells an nginx-style proxy not to buffer it either.
      'X-Accel-Buffering': 'no',
    },
  })
}
