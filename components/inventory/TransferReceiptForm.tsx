'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PackageCheck } from 'lucide-react'
import { ExpiryBadge } from '@/components/inventory/ExpiryBadge'
import { Field, inputClass, primaryButtonClass } from '@/components/ui/form'
import { formatPeso, formatQuantity } from '@/lib/format'
import { TRANSFER_VARIANCE_REASONS } from '@/lib/transfer-variance'
// Type-only, so nothing from the service (or Prisma behind it) is bundled into the browser.
import type { TransferMovementDto } from '@/services/stock-transfer.service'

const QUANTITY_PATTERN = /^\d+(\.\d+)?$/

/**
 * Display arithmetic only — the server works it out again in Decimal and that
 * is what gets recorded. Rounded to the gram and the centavo so a float never
 * shows its tail (0.3 × 400 = 120.00000000000001).
 */
function short(sent: string, received: string): number | null {
  if (!QUANTITY_PATTERN.test(received.trim())) return null
  return Math.round((Number(sent) - Number(received)) * 1000) / 1000
}

/**
 * The receiving branch counts what arrived (Week 8 Task 4, V1): one row per
 * lot that left the sender, Received pre-filled with what was sent — change
 * only what differs. Anything short needs a reason (V4); the difference is a
 * loss on the transfer (V3), valued at each lot's cost. The server checks it
 * all again.
 */
export function TransferReceiptForm({ transferId, transferNumber, branchName, lots }: {
  transferId: string
  transferNumber: string
  branchName: string
  lots: TransferMovementDto[]
}) {
  const router = useRouter()
  const [received, setReceived] = useState<Record<string, string>>(
    () => Object.fromEntries(lots.map(lot => [lot.lotId, lot.quantity])),
  )
  const [reason, setReason] = useState('')
  const [notes, setNotes]   = useState('')
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const rows = lots.map(lot => {
    const missing = short(lot.quantity, received[lot.lotId] ?? '')
    const invalid = missing === null || missing < 0 || missing > Number(lot.quantity)
    const value   = !invalid && missing !== null && lot.unitCost !== null
      ? Math.round(missing * Number(lot.unitCost) * 100) / 100
      : null
    return { lot, missing, invalid, value }
  })
  const anyShort   = rows.some(row => !row.invalid && (row.missing ?? 0) > 0)
  const totalValue = rows.reduce<number | null>((sum, row) => sum === null || row.value === null ? null : sum + row.value, 0)

  const fieldErrors: string[] = []
  for (const row of rows) {
    if (row.invalid) {
      fieldErrors.push(`${row.lot.finishedGoodName} ${row.lot.lotNumber}: enter 0 to ${formatQuantity(row.lot.quantity)} ${row.lot.unitAbbreviation} — more than was sent is a dispatch miscount; tell the kitchen.`)
    }
  }
  if (anyShort && reason === '') fieldErrors.push('Choose why it arrived short.')
  if (anyShort && reason === 'OTHER' && notes.trim() === '') fieldErrors.push('Say what happened when the reason is Other.')

  async function submit() {
    const message = anyShort
      ? `Confirm ${transferNumber} arrived SHORT at ${branchName}? What arrived joins its stock; the rest (≈ ${formatPeso((totalValue ?? 0).toFixed(2))}) is recorded as lost in transit.`
      : `Confirm everything on ${transferNumber} arrived at ${branchName}? It joins ${branchName}'s stock.`
    if (!window.confirm(message)) return

    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/transfers/${transferId}/receive`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          lots:   lots.map(lot => ({ lotId: lot.lotId, received: (received[lot.lotId] ?? '').trim() })),
          reason: anyShort ? reason : null,
          notes:  anyShort && notes.trim() !== '' ? notes.trim() : null,
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
      setBusy(false)
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-sky-200 bg-white p-4">
      <h2 className="text-base font-semibold text-gray-800">Confirm what arrived</h2>
      <p className="mb-3 text-sm text-gray-500">
        Count each lot. Received starts at what was sent — change only what differs. What arrives joins {branchName}&apos;s stock;
        anything short is recorded as lost in transit, at the lot&apos;s cost.
      </p>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">Lot</th>
              <th className="px-3 py-2 text-right font-medium">Sent</th>
              <th className="w-40 px-3 py-2 font-medium">Received</th>
              <th className="px-3 py-2 text-right font-medium">Short</th>
              <th className="px-3 py-2 text-right font-medium">Value lost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(({ lot, missing, invalid, value }) => (
              <tr key={lot.lotId} className={invalid ? 'bg-red-50/60' : (missing ?? 0) > 0 ? 'bg-amber-50/60' : ''}>
                <td className="px-3 py-2 text-gray-700">
                  {lot.finishedGoodName} <span className="font-mono text-xs text-gray-500">{lot.lotNumber}</span>{' '}
                  <ExpiryBadge flag={lot.expiry} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-800">{formatQuantity(lot.quantity)} {lot.unitAbbreviation}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={received[lot.lotId] ?? ''}
                      onChange={event => setReceived(current => ({ ...current, [lot.lotId]: event.target.value }))}
                      className={inputClass}
                    />
                    <span className="text-xs text-gray-500">{lot.unitAbbreviation}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {invalid || missing === null ? <span className="text-red-600">—</span>
                    : missing > 0 ? <span className="font-medium text-amber-700">{formatQuantity(String(missing))} {lot.unitAbbreviation}</span>
                    : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {value !== null && value > 0 ? <span className="text-amber-700">≈ {formatPeso(value.toFixed(2))}</span> : <span className="text-gray-400">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
          {anyShort && totalValue !== null && (
            <tfoot className="border-t border-gray-200 bg-gray-50">
              <tr>
                <td colSpan={4} className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Lost in transit</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-amber-700">≈ {formatPeso(totalValue.toFixed(2))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {anyShort && (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Why it arrived short">
            <select value={reason} onChange={event => setReason(event.target.value)} className={inputClass}>
              <option value="">Choose…</option>
              {TRANSFER_VARIANCE_REASONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label={reason === 'OTHER' ? 'What happened (required)' : 'What happened'}>
              <input
                value={notes}
                onChange={event => setNotes(event.target.value)}
                placeholder="e.g. one tray tipped over in the van"
                className={inputClass}
              />
            </Field>
          </div>
        </div>
      )}

      {fieldErrors.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {fieldErrors.map(message => <li key={message}>{message}</li>)}
        </ul>
      )}
      {error && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-4">
        <button
          type="button"
          onClick={submit}
          disabled={busy || fieldErrors.length > 0}
          className={`${primaryButtonClass} inline-flex items-center gap-1.5`}
        >
          <PackageCheck size={16} /> {busy ? 'Confirming…' : anyShort ? 'Confirm received — short' : 'Confirm received'}
        </button>
      </div>
    </section>
  )
}
