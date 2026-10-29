'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Field, inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'
import { trimDecimal } from '@/lib/format'
// A type-only import, so nothing from the service (or Prisma behind it) is
// bundled into the browser — same as PurchaseRequestForm's MaterialDto.
import type { ReceivingLineDto } from '@/services/receiving-report.service'

type Branch = { id: string; name: string }

export type ReceivingCount = { received: string; rejected: string; notes: string }

type Count = ReceivingCount

type Props = {
  purchaseOrderId: string
  /** Set when editing a draft: the form PATCHes it instead of creating one. */
  receivingReportId?: string
  branches: Branch[]
  today: string
  lines: ReceivingLineDto[]
  initial: {
    branchId: string
    receivedAt: string
    notes: string
    /** Keyed by purchaseOrderItemId. Omitted on create: counts start blank. */
    counts?: Record<string, Count>
  }
}

const QUANTITY_PATTERN = /^\d+(\.\d+)?$/

// The checks below are for the person typing, not for the database: the
// service re-checks everything in Decimal (subtask 1.5). Quantities are
// compared in millionths because plain floats get 10.3 - 0.1 wrong
// (10.200000000000001), which would flag a correct line as over-received.
function toMillionths(value: string): number {
  return Math.round(Number(value) * 1_000_000)
}

function lineError(line: ReceivingLineDto, count: Count): string | null {
  if (count.received === '') return null
  if (!QUANTITY_PATTERN.test(count.received)) return 'Received must be a number.'
  const rejected = count.rejected === '' ? '0' : count.rejected
  if (!QUANTITY_PATTERN.test(rejected)) return 'Rejected must be a number.'

  const accepted = toMillionths(count.received) - toMillionths(rejected)
  if (accepted < 0) return 'Rejected cannot be more than received.'
  if (accepted > toMillionths(line.outstanding)) {
    return 'More than is outstanding. Enter the extra as rejected.'
  }
  return null
}

function acceptedQuantity(count: Count): string | null {
  if (!QUANTITY_PATTERN.test(count.received)) return null
  const rejected = count.rejected === '' ? '0' : count.rejected
  if (!QUANTITY_PATTERN.test(rejected)) return null
  return String((toMillionths(count.received) - toMillionths(rejected)) / 1_000_000)
}

export function ReceivingReportForm({ purchaseOrderId, receivingReportId, branches, today, lines, initial }: Props) {
  const isEdit = receivingReportId !== undefined
  const [branchId, setBranchId]     = useState(initial.branchId)
  const [receivedAt, setReceivedAt] = useState(initial.receivedAt)
  const [notes, setNotes]           = useState(initial.notes)
  // On create, Received starts blank, not pre-filled with the outstanding
  // quantity: the report exists to record an actual count, and a pre-filled
  // form gets saved without anyone counting.
  const [counts, setCounts] = useState<Record<string, Count>>(() =>
    Object.fromEntries(lines.map(line => [
      line.purchaseOrderItemId,
      initial.counts?.[line.purchaseOrderItemId] ?? { received: '', rejected: '0', notes: '' },
    ])),
  )
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState<string | null>(null)

  function updateCount(id: string, patch: Partial<Count>) {
    setCounts(current => ({ ...current, [id]: { ...current[id], ...patch } }))
  }

  const errors = new Map(lines.map(line => [line.purchaseOrderItemId, lineError(line, counts[line.purchaseOrderItemId])]))
  const hasLineError = [...errors.values()].some(Boolean)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    // A line that did not arrive at all is entered as 0, so a blank means the
    // line has not been counted yet.
    if (lines.some(line => counts[line.purchaseOrderItemId].received === '')) {
      setError('Enter a received quantity on every line. Use 0 for anything that did not arrive.')
      return
    }
    if (lines.every(line => toMillionths(counts[line.purchaseOrderItemId].received) === 0)) {
      setError('Nothing was received on any line.')
      return
    }

    // receivedById is deliberately absent: the server takes it from the
    // x-user-id header middleware injected, so nobody can record a delivery in
    // someone else's name. unitCost is absent too; it comes from the PO line.
    // purchaseOrderId only on create: an edit cannot move the report to
    // another order, and the PATCH schema does not accept it.
    const payload = {
      ...(isEdit ? {} : { purchaseOrderId }),
      branchId,
      receivedAt,
      notes: notes || null,
      items: lines.map(line => {
        const count = counts[line.purchaseOrderItemId]
        return {
          purchaseOrderItemId: line.purchaseOrderItemId,
          receivedQuantity:    count.received,
          rejectedQuantity:    count.rejected === '' ? '0' : count.rejected,
          notes:               count.notes || null,
        }
      }),
    }

    setSubmitting(true)
    try {
      const response = await fetch(
        isEdit ? `/api/receiving-reports/${receivingReportId}` : '/api/receiving-reports',
        {
          method:  isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        },
      )

      const body = await response.json().catch(() => null)

      if (!response.ok) {
        setError(body?.error ?? `Request failed (${response.status})`)
        return
      }

      // Straight to the report, now that it has a page.
      router.push(`/procurement/receiving/${body.receivingReport.id}`)
      router.refresh()
    } catch {
      setError('Could not reach the server')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Received at branch">
          <select value={branchId} onChange={event => setBranchId(event.target.value)} className={inputClass}>
            {branches.map(branch => (
              <option key={branch.id} value={branch.id}>{branch.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Received on">
          <input
            type="date"
            value={receivedAt}
            max={today}
            onChange={event => setReceivedAt(event.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Notes">
        <textarea
          rows={2}
          value={notes}
          onChange={event => setNotes(event.target.value)}
          placeholder="Delivery receipt number, driver, condition of the delivery…"
          className={inputClass}
        />
      </Field>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">Material</th>
              <th className="px-4 py-3 text-right font-medium">Ordered</th>
              <th className="px-4 py-3 text-right font-medium">Already received</th>
              <th className="px-4 py-3 text-right font-medium">Outstanding</th>
              <th className="w-28 px-4 py-3 font-medium">Received</th>
              <th className="w-28 px-4 py-3 font-medium">Rejected</th>
              <th className="px-4 py-3 text-right font-medium">Accepted</th>
              <th className="px-4 py-3 font-medium">Line notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lines.map(line => {
              const count    = counts[line.purchaseOrderItemId]
              const message  = errors.get(line.purchaseOrderItemId)
              const accepted = acceptedQuantity(count)
              const unit     = <span className="text-gray-400">{line.unitAbbreviation}</span>

              return (
                <tr key={line.purchaseOrderItemId} className={message ? 'bg-red-50/40' : undefined}>
                  <td className="px-4 py-3 align-top">
                    <p className="text-gray-700">{line.materialName}</p>
                    <p className="font-mono text-xs text-gray-400">{line.materialCode}</p>
                    {message && <p className="mt-1 text-xs text-red-600">{message}</p>}
                  </td>
                  <td className="px-4 py-3 text-right align-top text-gray-500">
                    {trimDecimal(line.orderedQuantity)} {unit}
                  </td>
                  <td className="px-4 py-3 text-right align-top text-gray-500">
                    {trimDecimal(line.alreadyReceived)} {unit}
                  </td>
                  <td className="px-4 py-3 text-right align-top font-medium text-gray-700">
                    {trimDecimal(line.outstanding)} {unit}
                  </td>
                  <td className="px-4 py-2 align-top">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={count.received}
                      onChange={event => updateCount(line.purchaseOrderItemId, { received: event.target.value })}
                      placeholder="0"
                      aria-label={`Received ${line.materialName}`}
                      className={inputClass}
                    />
                  </td>
                  <td className="px-4 py-2 align-top">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={count.rejected}
                      onChange={event => updateCount(line.purchaseOrderItemId, { rejected: event.target.value })}
                      aria-label={`Rejected ${line.materialName}`}
                      className={inputClass}
                    />
                  </td>
                  <td className="px-4 py-3 text-right align-top text-gray-700">
                    {accepted === null ? <span className="text-gray-300">—</span> : <>{accepted} {unit}</>}
                  </td>
                  <td className="px-4 py-2 align-top">
                    <input
                      type="text"
                      value={count.notes}
                      onChange={event => updateCount(line.purchaseOrderItemId, { notes: event.target.value })}
                      placeholder="e.g. 2 kg spoiled"
                      aria-label={`Notes for ${line.materialName}`}
                      className={inputClass}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={hasLineError || submitting} className={primaryButtonClass}>
          {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Save draft'}
        </button>
        <Link
          href={isEdit ? `/procurement/receiving/${receivingReportId}` : `/procurement/orders/${purchaseOrderId}`}
          className={secondaryButtonClass}
        >
          Cancel
        </Link>
      </div>
    </form>
  )
}
