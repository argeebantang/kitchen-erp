'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'
import { formatQuantity } from '@/lib/format'
import type { StockRequestLineDto } from '@/services/stock-request.service'

const QUANTITY_PATTERN = /^\d+(\.\d+)?$/

/**
 * The kitchen answers a stock request (Week 9 Task 10, S-4): how much of each
 * line it will send — the asked quantity unless cut — and a note, required
 * when anything is cut; or Decline, with the note as the reason. The outlet
 * sees the note either way. The server checks everything again.
 */
export function StockRequestDecision({ requestId, lines }: { requestId: string; lines: StockRequestLineDto[] }) {
  const router = useRouter()
  const [planned, setPlanned] = useState<Record<string, string>>(
    Object.fromEntries(lines.map(line => [line.itemId, line.quantity])),
  )
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'plan' | 'decline' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const invalid = lines.filter(line => {
    const value = planned[line.itemId]?.trim() ?? ''
    return !QUANTITY_PATTERN.test(value) || Number(value) > Number(line.quantity)
  })
  const cut = lines.some(line => Number(planned[line.itemId]) < Number(line.quantity))
  const nothing = lines.every(line => Number(planned[line.itemId]) === 0)

  async function send(action: 'plan' | 'decline') {
    setError(null)
    setBusy(action)
    try {
      const response = await fetch(`/api/stock-requests/${requestId}/${action}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(action === 'plan'
          ? { lines: lines.map(line => ({ itemId: line.itemId, plannedQuantity: planned[line.itemId].trim() })), note: note || null }
          : { reason: note }),
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
    <section id="decide" className="mb-6 rounded-xl border border-orange-200 bg-white p-4">
      <h2 className="text-lg font-semibold text-gray-800">Answer this request</h2>
      <p className="mb-3 text-sm text-gray-500">
        Plan what the kitchen will send — lower a line if you can&apos;t make it all, and say why. Or decline it, with the reason.
      </p>
      <table className="mb-3 w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="py-1 font-medium">Finished good</th>
            <th className="py-1 text-right font-medium">Asked</th>
            <th className="w-44 py-1 pl-4 font-medium">Will send</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {lines.map(line => (
            <tr key={line.itemId}>
              <td className="py-2 text-gray-800">{line.finishedGoodName}</td>
              <td className="py-2 text-right tabular-nums text-gray-600">{formatQuantity(line.quantity)} {line.unitAbbreviation}</td>
              <td className="py-2 pl-4">
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={planned[line.itemId] ?? ''}
                    onChange={event => setPlanned(current => ({ ...current, [line.itemId]: event.target.value }))}
                    className={inputClass}
                    aria-label={`${line.finishedGoodName} to send`}
                  />
                  <span className="text-xs text-gray-500">{line.unitAbbreviation}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500">
          Note for the outlet {cut ? '(required: less than asked)' : '(required to decline)'}
        </span>
        <textarea rows={2} value={note} onChange={event => setNote(event.target.value)} className={inputClass} placeholder="e.g. pork short until Monday's delivery" />
      </label>
      {invalid.length > 0 && (
        <p className="mt-2 text-sm text-amber-700">Each line takes a number between 0 and what was asked.</p>
      )}
      {error && <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => send('plan')}
          disabled={busy !== null || invalid.length > 0 || nothing || (cut && note.trim() === '')}
          className={primaryButtonClass}
        >
          {busy === 'plan' ? 'Saving…' : cut ? 'Plan with cuts' : 'Plan it all'}
        </button>
        <button
          type="button"
          onClick={() => send('decline')}
          disabled={busy !== null || note.trim() === ''}
          className={secondaryButtonClass}
        >
          {busy === 'decline' ? 'Declining…' : 'Decline'}
        </button>
        {nothing && <span className="text-xs text-gray-400">Nothing to send — decline it instead.</span>}
      </div>
    </section>
  )
}
