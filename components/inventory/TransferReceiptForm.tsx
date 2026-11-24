'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CircleCheck, Minus, PackageCheck, Plus } from 'lucide-react'
import { ExpiryBadge } from '@/components/inventory/ExpiryBadge'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Field, inputClass, primaryButtonClass } from '@/components/ui/form'
import { formatPeso, formatQuantity } from '@/lib/format'
import { TRANSFER_VARIANCE_REASONS, transferVarianceReasonLabel } from '@/lib/transfer-variance'
// Type-only, so nothing from the service (or Prisma behind it) is bundled into the browser.
import type { TransferMovementDto } from '@/services/stock-transfer.service'

const QUANTITY_PATTERN = /^\d+(\.\d+)?$/

// Big, thumb-sized buttons. Not primaryButtonClass + overrides: without
// tailwind-merge, which of two padding classes wins depends on CSS order.
const BIG_PRIMARY   = 'inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-orange-600 disabled:opacity-50'
const BIG_SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-3 text-base font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50'
const STEPPER       = 'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 transition-colors active:bg-gray-100 disabled:opacity-40'

/**
 * Display arithmetic only — the server works it out again in Decimal and that
 * is what gets recorded. Rounded to the gram and the centavo so a float never
 * shows its tail (0.3 × 400 = 120.00000000000001).
 */
function short(sent: string, received: string): number | null {
  if (!QUANTITY_PATTERN.test(received.trim())) return null
  return Math.round((Number(sent) - Number(received)) * 1000) / 1000
}

/** What − / + move by: tenths for a weight or volume, whole units for anything counted. */
function stepFor(unit: string): number {
  return /^(kg|l)$/i.test(unit) ? 0.1 : 1
}

const round3 = (value: number) => Math.round(value * 1000) / 1000

/**
 * The receiving branch counts what arrived (Week 8 Task 4, V1): one entry per
 * lot that left the sender, Received starting at what was sent. Anything
 * short needs a reason (V4); the difference is a loss on the transfer (V3),
 * valued at each lot's cost. The server checks it all again.
 *
 * On a phone (Week 12) it works like an app: each lot starts as "All
 * arrived" and only a short one is opened (Report short → − / + or type);
 * the reasons are buttons; a bar pinned to the bottom shows where things
 * stand and confirms; confirming and the result are a bottom sheet, never
 * the browser's own dialog. From `sm` up the lots are a table.
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
  // Phone only: the lots opened with Report short.
  const [editing, setEditing] = useState<Record<string, boolean>>({})
  const [reason, setReason] = useState('')
  const [notes, setNotes]   = useState('')
  const [sheet, setSheet]   = useState<'closed' | 'confirm' | 'done'>('closed')
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const rows = lots.map(lot => {
    const missing = short(lot.quantity, received[lot.lotId] ?? '')
    const invalid = missing === null || missing < 0 || missing > Number(lot.quantity)
    const value   = !invalid && missing !== null && lot.unitCost !== null
      ? Math.round(missing * Number(lot.unitCost) * 100) / 100
      : null
    return { lot, missing, invalid, value, isShort: !invalid && (missing ?? 0) > 0 }
  })
  const shortRows  = rows.filter(row => row.isShort)
  const anyShort   = shortRows.length > 0
  const totalValue = rows.reduce<number | null>((sum, row) => sum === null || row.value === null ? null : sum + row.value, 0)
  const lostText   = totalValue !== null && totalValue > 0 ? `≈ ${formatPeso(totalValue.toFixed(2))}` : null

  const fieldErrors: string[] = []
  for (const row of rows) {
    if (row.invalid) {
      fieldErrors.push(`${row.lot.finishedGoodName} ${row.lot.lotNumber}: enter 0 to ${formatQuantity(row.lot.quantity)} ${row.lot.unitAbbreviation} — more than was sent is a dispatch miscount; tell the kitchen.`)
    }
  }
  if (anyShort && reason === '') fieldErrors.push('Choose why it arrived short.')
  if (anyShort && reason === 'OTHER' && notes.trim() === '') fieldErrors.push('Say what happened when the reason is Other.')
  const blocked = fieldErrors.length > 0

  const lotWord = (n: number) => `${n} lot${n === 1 ? '' : 's'}`
  const status = blocked
    ? (rows.some(row => row.invalid) ? 'Check the quantities' : fieldErrors[0])
    : anyShort
      ? `${lotWord(shortRows.length)} short${lostText ? ` · ${lostText} lost` : ''}`
      : `All ${lotWord(lots.length)} arrived`

  function setLot(lotId: string, value: string) {
    setReceived(current => ({ ...current, [lotId]: value }))
  }

  function nudge(lot: TransferMovementDto, direction: 1 | -1) {
    const sent    = Number(lot.quantity)
    const typed   = received[lot.lotId] ?? ''
    const current = QUANTITY_PATTERN.test(typed.trim()) ? Number(typed) : sent
    const next    = round3(Math.min(sent, Math.max(0, current + direction * stepFor(lot.unitAbbreviation))))
    setLot(lot.lotId, String(next))
  }

  function reportShort(lot: TransferMovementDto) {
    setEditing(current => ({ ...current, [lot.lotId]: true }))
    // After the input renders: ready to type over the number.
    setTimeout(() => {
      const input = inputRefs.current[lot.lotId]
      input?.focus()
      input?.select()
    }, 0)
  }

  function allArrived(lot: TransferMovementDto) {
    setLot(lot.lotId, lot.quantity)
    setEditing(current => ({ ...current, [lot.lotId]: false }))
  }

  async function submit() {
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
      // A short buzz on phones that support it (Android); ignored elsewhere.
      navigator.vibrate?.(40)
      setSheet('done')
    } catch {
      setError('Could not reach the server')
    } finally {
      setBusy(false)
    }
  }

  // The page re-renders as RECEIVED, which removes this form — so only once
  // the person has seen the result.
  function finish() {
    setSheet('closed')
    router.refresh()
  }

  return (
    <section id="receive" className="mb-6 scroll-mt-6 rounded-xl border border-sky-200 bg-white p-4">
      <h2 className="text-base font-semibold text-gray-800">Confirm what arrived</h2>
      <p className="mb-3 text-sm text-gray-500">
        <span className="sm:hidden">Check each lot. Tap Report short only for one that is not all there.</span>
        <span className="hidden sm:inline">
          Count each lot. Received starts at what was sent — change only what differs. What arrives joins {branchName}&apos;s stock;
          anything short is recorded as lost in transit, at the lot&apos;s cost.
        </span>
      </p>

      {/* Phone: one card per lot. Same state as the table below — only one of the two is shown. */}
      <ul className="space-y-3 sm:hidden">
        {rows.map(({ lot, missing, invalid, value, isShort }) => {
          const open = editing[lot.lotId] ?? false
          return (
            <li
              key={lot.lotId}
              className={`rounded-xl border p-4 ${
                invalid ? 'border-red-200 bg-red-50/60' : isShort ? 'border-amber-200 bg-amber-50/60' : open ? 'border-gray-200' : 'border-emerald-200 bg-emerald-50/40'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-800">{lot.finishedGoodName}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                    <span className="font-mono">{lot.lotNumber}</span>
                    <ExpiryBadge flag={lot.expiry} />
                  </p>
                </div>
                <p className="shrink-0 text-right">
                  <span className="block text-xs text-gray-500">Sent</span>
                  <span className="text-lg font-semibold tabular-nums text-gray-800">{formatQuantity(lot.quantity)} {lot.unitAbbreviation}</span>
                </p>
              </div>

              {!open ? (
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                    <CircleCheck size={18} /> All arrived
                  </span>
                  <button
                    type="button"
                    onClick={() => reportShort(lot)}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 active:bg-gray-100"
                  >
                    Report short
                  </button>
                </div>
              ) : (
                <div className="mt-3">
                  <p className="mb-1.5 text-xs font-medium text-gray-600">Received</p>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => nudge(lot, -1)} aria-label={`Less ${lot.finishedGoodName}`} className={STEPPER}>
                      <Minus size={20} />
                    </button>
                    <div className="relative min-w-0 flex-1">
                      <input
                        ref={element => { inputRefs.current[lot.lotId] = element }}
                        type="text"
                        inputMode="decimal"
                        aria-label={`${lot.finishedGoodName} ${lot.lotNumber} received`}
                        value={received[lot.lotId] ?? ''}
                        onChange={event => setLot(lot.lotId, event.target.value)}
                        className={`h-12 w-full rounded-xl border bg-white pl-3 pr-10 text-center text-lg font-semibold tabular-nums text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400 ${invalid ? 'border-red-300' : 'border-gray-200'}`}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">{lot.unitAbbreviation}</span>
                    </div>
                    <button type="button" onClick={() => nudge(lot, 1)} aria-label={`More ${lot.finishedGoodName}`} className={STEPPER}>
                      <Plus size={20} />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                    {invalid ? (
                      <span className="text-red-600">Enter 0 to {formatQuantity(lot.quantity)} {lot.unitAbbreviation}</span>
                    ) : isShort ? (
                      <span className="font-medium text-amber-700">
                        Short {formatQuantity(String(missing))} {lot.unitAbbreviation}
                        {value !== null && value > 0 && <span className="font-normal"> · ≈ {formatPeso(value.toFixed(2))}</span>}
                      </span>
                    ) : (
                      <span className="text-gray-500">Nothing short</span>
                    )}
                    <button type="button" onClick={() => allArrived(lot)} className="shrink-0 font-medium text-emerald-700">
                      All arrived
                    </button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <div className="hidden overflow-x-auto rounded-lg border border-gray-200 sm:block">
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
                      aria-label={`${lot.finishedGoodName} ${lot.lotNumber} received`}
                      value={received[lot.lotId] ?? ''}
                      onChange={event => setLot(lot.lotId, event.target.value)}
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
        <div className="mt-4 space-y-3">
          <div>
            <p className="mb-1.5 text-sm font-medium text-gray-700">Why did it arrive short?</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Why it arrived short">
              {TRANSFER_VARIANCE_REASONS.map(option => {
                const selected = reason === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setReason(option.value)}
                    className={`rounded-xl border px-3 py-3 text-sm font-medium transition-colors sm:py-2 ${
                      selected ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          </div>
          <Field label={reason === 'OTHER' ? 'What happened (required)' : 'What happened (optional)'}>
            <textarea
              rows={2}
              value={notes}
              onChange={event => setNotes(event.target.value)}
              placeholder="e.g. one tray tipped over in the van"
              className={inputClass}
            />
          </Field>
        </div>
      )}

      {/* The full list from `sm` up; on a phone the bar below says what is missing, and a bad lot says so on its card. */}
      {blocked && (
        <ul className="mt-3 hidden space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 sm:block">
          {fieldErrors.map(message => <li key={message}>{message}</li>)}
        </ul>
      )}

      <div className="mt-4 hidden sm:block">
        <button type="button" onClick={() => setSheet('confirm')} disabled={blocked} className={`${primaryButtonClass} inline-flex items-center gap-1.5`}>
          <PackageCheck size={16} /> {anyShort ? 'Confirm received — short' : 'Confirm received'}
        </button>
      </div>

      {/* Phone: pinned to the bottom of the screen while this section is on it, within thumb reach. */}
      <div className="sticky bottom-0 -mx-4 -mb-4 mt-4 rounded-b-xl border-t border-gray-200 bg-white/95 px-4 pt-3 backdrop-blur pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:hidden">
        <div className="flex items-center gap-3">
          <p className={`min-w-0 flex-1 text-sm ${blocked || anyShort ? 'text-amber-700' : 'text-emerald-700'}`}>{status}</p>
          <button type="button" onClick={() => setSheet('confirm')} disabled={blocked} className={BIG_PRIMARY}>
            <PackageCheck size={18} /> Confirm
          </button>
        </div>
      </div>

      <BottomSheet
        open={sheet === 'confirm'}
        onClose={() => { setSheet('closed'); setError(null) }}
        dismissible={!busy}
        title={anyShort ? `${transferNumber} arrived short?` : `Everything on ${transferNumber} arrived?`}
      >
        <p className="text-sm text-gray-600">
          {anyShort
            ? <>What arrived joins {branchName}&apos;s stock. The rest is recorded as lost in transit{lostText && <> ({lostText})</>}.</>
            : <>All {lotWord(lots.length)} join {branchName}&apos;s stock.</>}
        </p>
        <ul className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-200 text-sm">
          {rows.map(({ lot, missing, isShort }) => (
            <li key={lot.lotId} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 text-gray-700">
                {lot.finishedGoodName} <span className="font-mono text-xs text-gray-400">{lot.lotNumber}</span>
              </span>
              <span className={`shrink-0 tabular-nums ${isShort ? 'font-medium text-amber-700' : 'text-gray-800'}`}>
                {formatQuantity(received[lot.lotId] ?? '0')} / {formatQuantity(lot.quantity)} {lot.unitAbbreviation}
                {isShort && missing !== null && <span className="block text-right text-xs font-normal">short {formatQuantity(String(missing))}</span>}
              </span>
            </li>
          ))}
        </ul>
        {anyShort && reason && (
          <p className="mt-2 text-sm text-gray-600">
            Reason: <span className="font-medium text-gray-800">{transferVarianceReasonLabel(reason)}</span>
            {notes.trim() && <> — {notes.trim()}</>}
          </p>
        )}
        {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" onClick={() => { setSheet('closed'); setError(null) }} disabled={busy} className={BIG_SECONDARY}>
            Back
          </button>
          <button type="button" onClick={submit} disabled={busy} className={BIG_PRIMARY}>
            {busy ? 'Confirming…' : 'Confirm'}
          </button>
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === 'done'} onClose={finish} title="Received">
        <div className="flex flex-col items-center py-2 text-center">
          <CircleCheck size={56} className="text-emerald-500" strokeWidth={1.75} />
          <p className="mt-3 font-semibold text-gray-800">{transferNumber} is in {branchName}&apos;s stock</p>
          <p className="mt-1 text-sm text-gray-500">
            {anyShort
              ? <>{lotWord(shortRows.length)} arrived short{lostText && <> — {lostText}</>} recorded as lost in transit.</>
              : 'Everything that was sent arrived.'}
          </p>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" onClick={finish} className={BIG_SECONDARY}>View transfer</button>
          <button type="button" onClick={() => { setSheet('closed'); router.push('/inventory/receive') }} className={BIG_PRIMARY}>
            Back to Receive
          </button>
        </div>
      </BottomSheet>
    </section>
  )
}
