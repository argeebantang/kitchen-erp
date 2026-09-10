'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Actions available on a DRAFT purchase request.
 *
 * A Client Component because a Server Component cannot carry onClick. Kept
 * deliberately small — only the button lives on the client; the page around it
 * stays a Server Component and ships no JavaScript.
 */
export function PurchaseRequestActions({ purchaseRequestId }: { purchaseRequestId: string }) {
  const router = useRouter()
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submitForApproval() {
    setBusy(true)
    setError(null)

    try {
      const response = await fetch(`/api/purchase-requests/${purchaseRequestId}/submit`, {
        method: 'POST',
      })

      // A 404 from Next returns an HTML page, not JSON, so .json() would throw.
      // The catch turns that into null instead of crashing the handler.
      const body = await response.json().catch(() => null)

      if (!response.ok) {
        setError(body?.error ?? `Request failed (${response.status})`)
        return
      }

      // No navigation. refresh() re-runs the Server Component behind this page,
      // so the status badge updates and this button disappears — it only
      // renders for a DRAFT.
      router.refresh()
    } catch {
      setError('Could not reach the server')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={submitForApproval}
        disabled={busy}
        className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
      >
        {busy ? 'Submitting…' : 'Submit for approval'}
      </button>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}