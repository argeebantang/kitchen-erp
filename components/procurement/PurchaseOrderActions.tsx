'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// The key doubles as the URL segment: POST /api/purchase-orders/[id]/submit
// and /send. One endpoint per transition so middleware.ts can authorise by path.
const COPY = {
  submit: {
    label: 'Submit for approval',
    busy:  'Submitting…',
    hint:  'Sends this order to accounting. It cannot be edited once submitted.',
    style: 'bg-orange-600 hover:bg-orange-700',
  },
  send: {
    label: 'Mark as sent',
    busy:  'Saving…',
    hint:  'Records that this approved order has gone to the supplier.',
    style: 'bg-blue-600 hover:bg-blue-700',
  },
} as const

type Mode = keyof typeof COPY

/**
 * Procurement's two buttons on a purchase order: submit a draft, mark an
 * approved order as sent.
 */
export function PurchaseOrderActions({
  mode,
  purchaseOrderId,
  blockedReason,
}: {
  mode: Mode
  purchaseOrderId: string
  blockedReason: string | null
}) {
  const router = useRouter()
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)
  const copy = COPY[mode]

  async function run() {
    setBusy(true)
    setError(null)

    try {
      const response = await fetch(`/api/purchase-orders/${purchaseOrderId}/${mode}`, {
        method: 'POST',
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
      setBusy(false)
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-gray-500">{blockedReason ?? copy.hint}</p>
        <button
          type="button"
          onClick={run}
          disabled={busy || blockedReason !== null}
          className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 ${copy.style}`}
        >
          {busy ? copy.busy : copy.label}
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
