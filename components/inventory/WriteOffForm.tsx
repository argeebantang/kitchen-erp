'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Field, inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'
import { formatDateTime } from '@/lib/dates'
import { ExpiryBadge } from '@/components/inventory/ExpiryBadge'
import { formatPeso, formatQuantity } from '@/lib/format'
// Type-only, so nothing from the service (or Prisma behind it) is bundled into
// the browser.
import type { WriteOffLotDto } from '@/services/write-off.service'

type Reason = { value: string; label: string; hint: string }

const QUANTITY_PATTERN = /^\d+(\.\d+)?$/

/**
 * Records a write-off of one lot at one branch (Week 7 Task 2): how much,
 * why, and a note. Submitting sends it straight to accounting; nothing leaves
 * stock until they approve it. Opened from a lot on Finished Goods, so the lot
 * is fixed; the quantity starts at everything still free to write off and the
 * reason at Expired for an expired lot. The server checks everything again.
 */
export function WriteOffForm({ lot, reasons }: { lot: WriteOffLotDto; reasons: Reason[] }) {
  const router = useRouter()
  const [quantity, setQuantity]     = useState(formatQuantity(lot.available, 6))
  const [reason, setReason]         = useState(lot.expired ? 'EXPIRED' : '')
  const [notes, setNotes]           = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState<string | null>(null)

  const unit = lot.unitAbbreviation
  // Compared in integer millionths, so 18.5 vs 18.500000 is not a float question.
  const millionths = (value: string) => Math.round(Number(value) * 1_000_000)
  const fieldErrors: string[] = []
  if (quantity !== '' && (!QUANTITY_PATTERN.test(quantity) || Number(quantity) <= 0)) {
    fieldErrors.push('The quantity must be a number greater than zero.')
  } else if (quantity !== '' && millionths(quantity) > millionths(lot.available)) {
    fieldErrors.push(`Lot ${lot.lotNumber} has only ${formatQuantity(lot.available)} ${unit} left to write off.`)
  }
  if (reason === 'OTHER' && notes.trim() === '') {
    fieldErrors.push('Say what happened in the notes when the reason is Other.')
  }

  // Display only, hence "≈": approval records the exact figure in Decimal.
  const estimate = lot.unitCost !== null && QUANTITY_PATTERN.test(quantity)
    ? formatPeso((Number(quantity) * Number(lot.unitCost)).toFixed(4))
    : null
  const incomplete = quantity === '' || reason === ''

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      // The submitter is deliberately absent: the server takes it from x-user-id.
      const response = await fetch('/api/write-offs', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ lotId: lot.lotId, branchId: lot.branchId, quantity, reason, notes: notes.trim() || null }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        setError(body?.error ?? `Request failed (${response.status})`)
        return
      }
      router.push(`/inventory/write-offs/${body.writeOff.id}`)
      router.refresh()
    } catch {
      setError('Could not reach the server')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className={`rounded-xl border p-4 text-sm ${lot.expired ? 'border-red-200 bg-red-50/60' : 'border-gray-200 bg-white'}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold text-gray-800">{lot.lotNumber}</span>
          <span className="text-gray-700">{lot.finishedGoodName}</span>
          <span className="font-mono text-xs text-gray-400">{lot.finishedGoodCode}</span>
          <ExpiryBadge flag={lot.expiry} />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <Fact label="Branch">{lot.branchName}</Fact>
          <Fact label="On hand">
            {formatQuantity(lot.onHand)} {unit}
            {Number(lot.pending) > 0 && (
              <span className="block text-xs text-amber-700">{formatQuantity(lot.pending)} {unit} already in pending write-offs</span>
            )}
          </Fact>
          <Fact label="Expires">
            {lot.expiresAt === null ? '—' : formatDateTime(lot.expiresAt)}
            <span className="block text-xs text-gray-400">produced {lot.producedOn}</span>
          </Fact>
          <Fact label="Cost">{lot.unitCost === null ? '—' : <>{formatPeso(lot.unitCost)}/{unit}</>}</Fact>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Quantity to write off (${unit})`}>
          <input
            type="text"
            inputMode="decimal"
            value={quantity}
            onChange={event => setQuantity(event.target.value)}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-gray-500">
            Up to {formatQuantity(lot.available)} {unit}
            {estimate !== null && <> · worth about <span className="font-medium text-gray-700">{estimate}</span></>}
          </p>
        </Field>

        <Field label="Reason">
          <select value={reason} onChange={event => setReason(event.target.value)} className={inputClass}>
            <option value="">Choose why…</option>
            {reasons.map(option => (
              <option key={option.value} value={option.value}>{option.label} — {option.hint}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label={reason === 'OTHER' ? 'Notes (required)' : 'Notes'}>
        <textarea
          rows={2}
          value={notes}
          onChange={event => setNotes(event.target.value)}
          placeholder="What happened, anything accounting should know…"
          className={inputClass}
        />
      </Field>

      {fieldErrors.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {fieldErrors.map(message => <li key={message}>{message}</li>)}
        </ul>
      )}
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={incomplete || fieldErrors.length > 0 || submitting} className={primaryButtonClass}>
          {submitting ? 'Submitting…' : 'Submit for approval'}
        </button>
        <Link href="/inventory/finished-goods" className={secondaryButtonClass}>Cancel</Link>
        <span className="text-xs text-gray-400">It leaves stock when accounting approves it — there is no draft.</span>
      </div>
    </form>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-0.5 text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-gray-800">{children}</p>
    </div>
  )
}
