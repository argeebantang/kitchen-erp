'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/** Several signals in a burst (an approval moves many lots) → one refresh. */
const DEBOUNCE_MS = 1_000
/** Expiry badges age without any signal, and a dropped signal is caught up. */
const FALLBACK_MS = 2 * 60_000
const MAX_RETRY_MS = 30_000

/**
 * Keeps a Branch Inventory page live (Week 8 Task 5, I3): re-renders its
 * Server Components when the server says stock moved
 * (app/api/inventory/stream), about a second after the last signal, and
 * otherwise every 2 minutes and when the tab comes back into view.
 * router.refresh() keeps client state — an open stock popup survives it.
 *
 * Renders "· live" while the stream is open, else "· refreshing every 2 min".
 * The connect / backoff / hidden-tab handling follows hooks/useNotifications.
 */
export function LiveRefresh({ branchId }: { branchId: string | null }) {
  const router = useRouter()
  const [live, setLive] = useState(false)

  useEffect(() => {
    const url = branchId ? `/api/inventory/stream?branch=${encodeURIComponent(branchId)}` : '/api/inventory/stream'
    let source: EventSource | null = null
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let debounceTimer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    let opened = false

    function scheduleRefresh() {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => router.refresh(), DEBOUNCE_MS)
    }

    function connect() {
      source = new EventSource(url)

      source.onopen = () => {
        attempts = 0
        setLive(true)
        // Not on the first open — the page was just rendered. A reconnect may
        // have missed signals, so it catches up.
        if (opened) scheduleRefresh()
        opened = true
      }

      source.addEventListener('inventory', scheduleRefresh)

      source.onerror = () => {
        setLive(false)
        // CONNECTING: the browser reconnects by itself. CLOSED: it gave up
        // (404, 503, session expired) — retry ourselves, backing off to 30 s.
        if (source?.readyState === EventSource.CLOSED) {
          source = null
          const delay = Math.min(1000 * 2 ** attempts++, MAX_RETRY_MS)
          retryTimer = setTimeout(() => {
            retryTimer = undefined
            connect()
          }, delay)
        }
      }
    }

    function disconnect() {
      clearTimeout(retryTimer)
      retryTimer = undefined
      source?.close()
      source = null
      setLive(false)
    }

    // A hidden tab holds no connection (6 per site over HTTP/1.1, shared with
    // the bell's stream); coming back refreshes and reconnects.
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        disconnect()
      } else {
        scheduleRefresh()
        if (!source && !retryTimer) connect()
      }
    }

    const fallback = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh()
    }, FALLBACK_MS)

    if (document.visibilityState === 'visible') connect()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      clearInterval(fallback)
      clearTimeout(debounceTimer)
      disconnect()
    }
  }, [router, branchId])

  return live ? (
    <span className="inline-flex items-center gap-1 text-emerald-600" title="Refreshes by itself when stock moves">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
      live
    </span>
  ) : (
    <span className="text-gray-400" title="Not connected for live updates">refreshing every 2 min</span>
  )
}
