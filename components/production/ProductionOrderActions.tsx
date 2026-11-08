'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Production's next step on an order: submit a draft (Task 5) or start an
 * approved run (Task 6). One card because both are a single POST with no body
 * whose only differences are the URL and the words. Same shape as
 * ReceivingReportActions. The service re-checks everything; the props only
 * explain up front what it will say.
 */
const COPY = {
  submit: {
    intro:  'Sends this order to accounting for approval. It cannot be edited once submitted.',
    short:  'you can still submit; accounting will see the shortage.',
    button: 'Submit for approval',
    busy:   'Submitting…',
  },
  start: {
    intro:  'Marks the run as started in the kitchen. Stock is deducted when it is completed (Week 6).',
    short:  'you can still start if the kitchen has them on hand.',
    button: 'Start production',
    busy:   'Starting…',
  },
} as const

export function ProductionOrderActions({
  kind, productionOrderId, shortCount, ingredientCount, branchName, blockedReason,
}: {
  kind: keyof typeof COPY
  productionOrderId: string
  /** Ingredients short at the branch now. Shortages warn, never block (Task 5 D3, Task 6 D3). */
  shortCount: number
  ingredientCount: number
  branchName: string
  /** Set when the service would refuse anyway, e.g. a superseded BOM pin. */
  blockedReason: string | null
}) {
  const router = useRouter()
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)
  const copy = COPY[kind]

  async function run() {
    setBusy(true)
    setError(null)

    try {
      const response = await fetch(`/api/production-orders/${productionOrderId}/${kind}`, { method: 'POST' })
      const body = await response.json().catch(() => null)

      if (!response.ok) {
        setError(body?.error ?? `Request failed (${response.status})`)
        return
      }

      // The page re-renders in the new status, where this card no longer shows.
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
        <div className="text-sm">
          <p className="text-gray-500">{copy.intro}</p>
          {shortCount > 0 && (
            <p className="mt-1 text-amber-700">
              {shortCount} of {ingredientCount} {ingredientCount === 1 ? 'ingredient is' : 'ingredients are'} short
              at {branchName} — {copy.short}
            </p>
          )}
          {blockedReason && <p className="mt-1 text-red-700">{blockedReason}</p>}
        </div>
        <button
          type="button"
          onClick={run}
          disabled={busy || blockedReason !== null}
          className="shrink-0 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-700 disabled:opacity-50"
        >
          {busy ? copy.busy : copy.button}
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
