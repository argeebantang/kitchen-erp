'use client'

import { useCallback, useEffect, useState } from 'react'
import type { NotificationListDto } from '@/services/notification.service'

const STREAM_URL = '/api/notifications/stream'
const MAX_RETRY_MS = 30_000

/**
 * The signed-in user's notifications for the bell, kept live over Server-Sent
 * Events (app/api/notifications/stream). No polling: `load` runs when the
 * stream opens (first connect and every reconnect, which catches up on
 * anything missed) and whenever the server says something changed.
 */
export function useNotifications() {
  const [data, setData] = useState<NotificationListDto | null>(null)

  // The only way the data changes. An event means "reload", nothing more.
  const load = useCallback(async () => {
    const res = await fetch('/api/notifications', { cache: 'no-store' })
    if (res.ok) setData(await res.json())
  }, [])

  useEffect(() => {
    let source: EventSource | null = null
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0

    function connect() {
      // Same origin, so the session cookie goes along and middleware
      // authenticates the stream like any other request.
      source = new EventSource(STREAM_URL)

      source.onopen = () => {
        attempts = 0
        void load()
      }

      source.addEventListener('notifications', () => void load())

      source.onerror = () => {
        // CONNECTING: the browser is already reconnecting by itself (network
        // blip, server restart), after the server's `retry:` delay.
        // CLOSED: it has given up — the response was not an event stream,
        // e.g. the session expired and middleware redirected to /login, or
        // Redis was down (503). Retry ourselves, backing off to 30 s.
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
    }

    // A hidden tab holds no connection — browsers allow 6 per site over
    // HTTP/1.1 — and coming back reconnects, which reloads via onopen.
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') disconnect()
      else if (!source && !retryTimer) connect()
    }

    if (document.visibilityState === 'visible') connect()
    else void load() // opened in a background tab: show the count, connect when seen
    document.addEventListener('visibilitychange', onVisibilityChange)

    // Unmount (logout, leaving the protected layout). Under React Strict Mode
    // in dev this also runs between the double mount, so nothing leaks.
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      disconnect()
    }
  }, [load])

  return { data, reload: load }
}
