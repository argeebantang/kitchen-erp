'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Re-renders the page's Server Components every `seconds` while the tab is
 * visible, and once when the tab comes back into view. router.refresh()
 * re-fetches the server render without a reload, so client state (an open
 * popup, a folded <details>) survives it. Renders nothing.
 */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter()

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') router.refresh()
    }
    const timer = setInterval(refreshIfVisible, seconds * 1000)
    document.addEventListener('visibilitychange', refreshIfVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshIfVisible)
    }
  }, [router, seconds])

  return null
}
