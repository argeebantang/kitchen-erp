'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'
import { trimDecimal } from '@/lib/format'
import { Modal } from '@/components/ui/Modal'
import { Field, inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'

const QUANTITY_PATTERN = /^\d+(\.\d+)?$/

// For the person typing only — the service re-checks in Decimal. Compared in
// millionths because plain floats get 10.3 - 0.1 wrong (as in ReceivingReportForm).
function toMillionths(value: string): number {
  return Math.round(Number(value) * 1_000_000)
}

/**
 * The yield against the plan as the kitchen types it: "−0.4 kg (96% of plan)".
 * Null until the figure is a usable number.
 */
function differenceFromPlan(actual: string, planned: string, unit: string): string | null {
  if (!QUANTITY_PATTERN.test(actual) || toMillionths(actual) === 0) return null
  const difference = toMillionths(actual) - toMillionths(planned)
  const percent    = Math.round((toMillionths(actual) / toMillionths(planned)) * 1000) / 10
  const sign       = difference > 0 ? '+' : difference < 0 ? '−' : '±'
  return `${sign}${Math.abs(difference) / 1_000_000} ${unit} (${percent}% of plan)`
}

/**
 * Report a run done with its actual yield (Week 6 Task 1, D4). A card on an
 * in-progress order, like the Start card, opening a dialog for the figure.
 * Nothing moves in stock here: accounting approves the completion first.
 */
export function CompleteProductionOrder({
  productionOrderId, orderNumber, finishedGoodName, plannedQty, unitAbbreviation, maxYieldFactor,
}: {
  productionOrderId: string
  orderNumber: string
  finishedGoodName: string
  /** Decimal string, as stored. */
  plannedQty: string
  unitAbbreviation: string
  /** The service's MAX_YIELD_FACTOR, so the dialog warns before the server refuses. */
  maxYieldFactor: number
}) {
  const router = useRouter()
  const [open, setOpen]         = useState(false)
  const [actualQty, setActual]  = useState('')
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const planned    = trimDecimal(plannedQty)
  const difference = differenceFromPlan(actualQty, plannedQty, unitAbbreviation)

  function close() {
    if (busy) return
    setOpen(false)
    setError(null)
  }

  async function complete(event: React.FormEvent) {
    event.preventDefault()
    if (!QUANTITY_PATTERN.test(actualQty) || toMillionths(actualQty) === 0) {
      setError(`Enter what the run actually yielded, in ${unitAbbreviation}, more than zero.`)
      return
    }
    if (toMillionths(actualQty) > toMillionths(plannedQty) * maxYieldFactor) {
      setError(`That is more than ${maxYieldFactor} × the planned ${planned} ${unitAbbreviation} — check the figure.`)
      return
    }

    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/production-orders/${productionOrderId}/complete`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ actualQty }),
      })
      const body = await response.json().catch(() => null)

      if (!response.ok) {
        setError(body?.error ?? `Request failed (${response.status})`)
        return
      }

      setOpen(false)
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
          In the kitchen. When the run is done, report what it actually yielded. Accounting then approves the
          completion — that is when the ingredients are deducted and the {finishedGoodName} is added to stock.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-700"
        >
          <CheckCircle2 size={16} />
          Complete production
        </button>
      </div>

      {open && (
        <Modal title={`Complete ${orderNumber}`} onClose={close}>
          <form onSubmit={complete} className="space-y-4">
            <p className="text-sm text-gray-500">
              Weigh the finished {finishedGoodName} and enter the total. Planned: <span className="font-medium text-gray-700">{planned} {unitAbbreviation}</span>.
            </p>
            <Field label={`Actual yield (${unitAbbreviation})`}>
              <input
                type="text"
                inputMode="decimal"
                value={actualQty}
                onChange={event => setActual(event.target.value.trim())}
                placeholder={planned}
                className={inputClass}
                autoFocus
              />
            </Field>
            {difference && (
              <p className="text-sm text-gray-600">
                {difference}
              </p>
            )}
            <p className="text-xs text-gray-400">
              The order then waits for accounting. It cannot be edited; if the figure is wrong, accounting rejects
              the completion and you report it again.
            </p>
            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={close} className={secondaryButtonClass}>Not yet</button>
              <button type="submit" disabled={busy} className={primaryButtonClass}>
                {busy ? 'Reporting…' : 'Report completion'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
