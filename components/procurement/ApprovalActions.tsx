'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Decision = 'APPROVED' | 'REJECTED'

/**
 * Approve / reject controls for a request awaiting approval.
 *
 * Posts to the single /api/approvals endpoint rather than a per-document route:
 * middleware.ts guards that one prefix to ACCOUNTING and ADMIN, so the same
 * guard will cover purchase orders later without a second rule.
 */
export function ApprovalActions({ purchaseRequestId }: { purchaseRequestId: string }) {
  const router = useRouter()
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy]       = useState<Decision | null>(null)
  const [error, setError]     = useState<string | null>(null)

  async function decide(decision: Decision) {
    // A rejection with no reason leaves the requester guessing what to fix.
    // Checked here for fast feedback; the service will enforce it as well.
    if (decision === 'REJECTED' && remarks.trim() === '') {
      setError('Give a reason when rejecting, so the requester knows what to change.')
      return
    }

    setBusy(decision)
    setError(null)

    try {
      const response = await fetch('/api/approvals', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          referenceType: 'PurchaseRequest',
          referenceId:   purchaseRequestId,
          decision,
          remarks:       remarks.trim() || null,
        }),
      })
      const body = await response.json().catch(() => null)

      if (!response.ok) {
        setError(body?.error ?? `Request failed (${response.status})`)
        return
      }

      router.refresh()
    } catch {
      setError('Could not reach the server')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="mb-2 text-sm font-medium text-gray-700">Your decision</p>

      <textarea
        rows={2}
        value={remarks}
        onChange={event => setRemarks(event.target.value)}
        placeholder="Remarks — required when rejecting"
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400"
      />

      {error && (
        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => decide('REJECTED')}
          disabled={busy !== null}
          className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
        >
          {busy === 'REJECTED' ? 'Rejecting…' : 'Reject'}
        </button>
        <button
          type="button"
          onClick={() => decide('APPROVED')}
          disabled={busy !== null}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy === 'APPROVED' ? 'Approving…' : 'Approve'}
        </button>
      </div>
    </div>
  )
}
