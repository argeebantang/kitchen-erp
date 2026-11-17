import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ensureSubscribed, onInventoryChanged } from '@/lib/realtime'
import { BranchInventoryService } from '@/services/branch-inventory.service'

/**
 * Server-Sent Events for Branch Inventory (Week 8 Task 5, I3): an `inventory`
 * event whenever stock at the branch moves — `?branch=<id>` — or at any
 * branch when there is no `branch` (the index). The page's LiveRefresh
 * re-renders on it; the event itself carries nothing. Built like
 * app/api/notifications/stream.
 *
 * A branch manager may watch only their own branch, as on the page; anything
 * else they ask for is 404, so a branch id reveals nothing (I4).
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Comment lines keep proxies and load balancers from closing an idle stream. */
const HEARTBEAT_MS = 25_000
/** How long EventSource waits before reconnecting after a drop. */
const RETRY_MS = 5_000

const QuerySchema = z.object({ branch: z.string().cuid().nullable() })

export async function GET(req: NextRequest) {
  const userId = req.headers.get('x-user-id')
  const role   = req.headers.get('x-user-role')
  if (!userId || !role) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const query = QuerySchema.safeParse({ branch: req.nextUrl.searchParams.get('branch') })
  if (!query.success) {
    return NextResponse.json({ error: 'Branch not found' }, { status: 404 })
  }
  const branchId = query.data.branch
  if (!(await BranchInventoryService.mayWatch(branchId, { userId, role }))) {
    return NextResponse.json({ error: 'Branch not found' }, { status: 404 })
  }

  try {
    await ensureSubscribed()
  } catch (err) {
    // Not an event stream, so EventSource gives up; LiveRefresh backs off and
    // retries, and the page still refreshes every 2 minutes.
    console.error('[GET /api/inventory/stream] Redis unavailable', err)
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

      const unsubscribe = onInventoryChanged(branchId, () => send('event: inventory\ndata: {}\n\n'))
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
