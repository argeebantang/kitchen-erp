'use client'

import { useState } from 'react'
import { Field, inputClass, primaryButtonClass } from '@/components/ui/form'
import { useRouter } from 'next/navigation'

type SupplierOption = { id: string; name: string }

/**
 * Editing a DRAFT purchase order: who to buy from, when it is wanted, and any
 * note for the supplier.
 *
 * Quantities are absent on purpose — they were approved on the purchase request,
 * and letting procurement change them here would make that approval meaningless.
 * Unit costs are absent too: the server re-prices every line from ItemPrice for
 * the chosen supplier, and a manual override would need a column recording which
 * lines a human set, which does not exist yet.
 */
export function PurchaseOrderForm({
  purchaseOrderId,
  suppliers,
  currentSupplierId,
  currentExpectedDelivery,
  currentNotes,
}: {
  purchaseOrderId: string
  suppliers: SupplierOption[]
  currentSupplierId: string | null
  currentExpectedDelivery: string
  currentNotes: string
}) {
  const [supplierId, setSupplierId] = useState(currentSupplierId ?? '')
  const [expectedDelivery, setExpectedDelivery] = useState(currentExpectedDelivery)
  const [notes, setNotes] = useState(currentNotes)
  const router = useRouter()
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)


    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault()
        setBusy(true)
        setError(null)

        try {
        const response = await fetch(`/api/purchase-orders/${purchaseOrderId}`, {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
            // Empty strings become null — an untouched date field and a cleared
            // one mean the same thing to the server, and '' is not a date.
            supplierId:       supplierId || null,
            expectedDelivery: expectedDelivery || null,
            notes:            notes.trim() || null,
            }),
        })

        const body = await response.json().catch(() => null)

        if (!response.ok) {
            setError(body?.error ?? `Request failed (${response.status})`)
            return
        }

        // Re-runs the Server Component, so the lines table below shows the
        // re-priced figures the server just calculated.
        router.refresh()
        } catch {
        setError('Could not reach the server')
        } finally {
        setBusy(false)
        }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">
        Sourcing
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Supplier">
          <select
            value={supplierId}
            onChange={event => setSupplierId(event.target.value)}
            className={inputClass}
          >
            <option value="">Select a supplier…</option>
            {suppliers.map(supplier => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Expected delivery">
          <input
            type="date"
            value={expectedDelivery}
            onChange={event => setExpectedDelivery(event.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Notes for the supplier">
          <textarea
            rows={2}
            value={notes}
            onChange={event => setNotes(event.target.value)}
            placeholder="Delivery instructions, reference numbers…"
            className={inputClass}
          />
        </Field>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        Saving re-prices every line against the chosen supplier, falling back to the reference
        price where that supplier has no quote.
      </p>

      <div className="mt-4 flex justify-end">
        {error && (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
            </p>
        )}

        <div className="mt-4 flex justify-end">
            <button type="submit" disabled={busy} className={primaryButtonClass}>
            {busy ? 'Saving…' : 'Save'}
            </button>
        </div>
      </div>
    </form>
  )
}