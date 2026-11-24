'use client'

import { useEffect, useRef, useState } from 'react'
import { CloudOff, Wifi } from 'lucide-react'

const BACK_ONLINE_MS = 3000

/**
 * The offline indicator (Week 12 PWA): a strip under the top bar while the
 * device has no connection, so nobody counts a delivery believing it saved;
 * then "Back online" for a moment when it returns. From the browser's
 * online / offline events — navigator.onLine can say "online" on a network
 * with no internet, but it never says "offline" wrongly, which is the case
 * that matters here. Starts as online so the server render and the first
 * client render agree; the real state is read after mount.
 */
export function OfflineBanner() {
  const [state, setState] = useState<'online' | 'offline' | 'back'>('online')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    function goOffline() {
      clearTimeout(timer.current)
      setState('offline')
    }
    function goOnline() {
      setState(current => (current === 'offline' ? 'back' : current))
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setState('online'), BACK_ONLINE_MS)
    }
    if (!navigator.onLine) goOffline()
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
      clearTimeout(timer.current)
    }
  }, [])

  if (state === 'online') return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2 border-b px-4 py-2 text-sm md:px-6 ${
        state === 'offline' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
      }`}
    >
      {state === 'offline' ? (
        <>
          <CloudOff size={16} className="shrink-0" />
          <span><span className="font-semibold">You&apos;re offline.</span> Nothing you save will reach KitchenERP until the connection is back.</span>
        </>
      ) : (
        <>
          <Wifi size={16} className="shrink-0" />
          <span className="font-semibold">Back online.</span>
        </>
      )}
    </div>
  )
}
