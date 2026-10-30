'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Procurement's submit button on a draft receiving report. Same shape as
 * PurchaseOrderActions; a separate component because the URL and copy differ
 * and receiving has only the one transition for procurement.
 */
export function ReceivingReportActions({ receivingReportId }: { receivingReportId: string }) {
  const router = useRouter()
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submitForApproval() {
    setBusy(true)
    setError(null)

    try {
      const response = await fetch(`/api/receiving-reports/${receivingReportId}/submit`, { method: 'POST' })
      const body = await response.json().catch(() => null)

      if (!response.ok) {
        setError(body?.error ?? `Request failed (${response.status})`)
        return
      }

      // The page re-renders as PENDING APPROVAL: this card and the Edit button
      // only render for a draft.
      router.refresh()
    } catch {
      setError('Could not reach the server')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-gray-500">
          Sends this count to accounting. It cannot be edited once submitted.
        </p>
        <button
          type="button"
          onClick={submitForApproval}
          disabled={busy}
          className="shrink-0 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-700 disabled:opacity-50"
        >
          {busy ? 'Submitting…' : 'Submit for approval'}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
