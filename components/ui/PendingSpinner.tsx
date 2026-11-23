'use client'

import { useLinkStatus } from 'next/link'
import { Loader2 } from 'lucide-react'

/**
 * Put inside a <Link>: a spinner from the click until the new page shows
 * (Week 12 Tasks 1–2). Needed where the page placeholder never appears — a
 * link that changes only the URL's `?…` (tabs, chips, paging) stays on the
 * same page segment, and in development nothing preloads, so every click
 * waits for the server. `data-pending` lets the link restyle itself with
 * Tailwind's `has-[[data-pending]]:` variant (the sidebar does).
 */
export function PendingSpinner({ className = 'ml-1.5 inline-flex align-[-2px]' }: { className?: string }) {
  const { pending } = useLinkStatus()
  if (!pending) return null
  return (
    <span data-pending role="status" className={className}>
      <Loader2 size={14} className="animate-spin" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </span>
  )
}
