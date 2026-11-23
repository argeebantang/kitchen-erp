'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Store } from 'lucide-react'
import { Field, inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'
import { addDays, timeOfDayAt } from '@/lib/dates'
// Type-only, so nothing from the service (or Prisma behind it) is bundled into the browser.
import type { StockRequestFormDto } from '@/services/stock-request.service'
import { EmptyState } from '@/components/ui/states'

type Line = { key: number; finishedGoodId: string; quantity: string }

type Props = StockRequestFormDto & { maxLines: number; initialBranchId?: string }

const QUANTITY_PATTERN = /^\d+(\.\d+)?$/

function positive(value: string): boolean {
  return QUANTITY_PATTERN.test(value.trim()) && Number(value) > 0
}

/**
 * An outlet asks a kitchen for finished goods by a day (Week 9 Task 10). No
 * approval: submitting sends it to the kitchen. A day that misses the cut-off
 * is allowed and flagged Late — the form says so before the click (the server
 * decides, by its own clock).
 */
export function StockRequestForm({ outlets, kitchens, finishedGoods, today, cutoff, maxLines, initialBranchId }: Props) {
  const router = useRouter()
  const [branchId, setBranchId]   = useState(outlets.find(o => o.id === initialBranchId)?.id ?? outlets[0]?.id ?? '')
  const [kitchenId, setKitchenId] = useState(kitchens.length === 1 ? kitchens[0].id : '')
  // Tomorrow by default: the usual order for the next day.
  const [neededOn, setNeededOn]   = useState(addDays(today, 1))
  const [notes, setNotes]         = useState('')
  const [lines, setLines]         = useState<Line[]>([{ key: 1, finishedGoodId: '', quantity: '' }])
  const [nextKey, setNextKey]     = useState(2)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]         = useState<string | null>(null)

  function updateLine(key: number, patch: Partial<Line>) {
    setLines(current => current.map(line => line.key === key ? { ...line, ...patch } : line))
  }

  const chosen = lines.map(line => line.finishedGoodId).filter(Boolean)
  const fieldErrors: string[] = []
  if (new Set(chosen).size !== chosen.length) fieldErrors.push('Each finished good may appear on one line only — add the quantities together.')
  for (const line of lines) {
    if (line.quantity !== '' && !positive(line.quantity)) {
      const name = finishedGoods.find(good => good.id === line.finishedGoodId)?.name ?? 'A line'
      fieldErrors.push(`${name}: the quantity must be a number greater than zero.`)
    }
  }
  if (neededOn && neededOn < today) fieldErrors.push('The day it is needed cannot be in the past.')
  const incomplete = !branchId || !kitchenId || !neededOn || lines.some(line => !line.finishedGoodId || !line.quantity)
  // A hint only — the server stamps Late by its own clock.
  const dayBefore = neededOn ? addDays(neededOn, -1) : ''
  const lateHint = neededOn !== '' && (today >= neededOn || (today === dayBefore && timeOfDayAt(new Date()) >= cutoff))

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const response = await fetch('/api/stock-requests', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          branchId, kitchenId, neededOn, notes: notes || null,
          lines: lines.map(line => ({ finishedGoodId: line.finishedGoodId, quantity: line.quantity.trim() })),
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        setError(body?.error ?? `Request failed (${response.status})`)
        return
      }
      router.push(`/inventory/requests/${body.stockRequest.id}`)
      router.refresh()
    } catch {
      setError('Could not reach the server')
    } finally {
      setSubmitting(false)
    }
  }

  if (outlets.length === 0) {
    return (
      <EmptyState icon={Store} title="No outlet to request for">
        Stock requests are made by an outlet&apos;s manager, and you do not run an active outlet.
      </EmptyState>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="For (outlet)">
          <select value={branchId} onChange={event => setBranchId(event.target.value)} className={inputClass}>
            {outlets.map(outlet => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}
          </select>
        </Field>
        <Field label="From (kitchen)">
          <select value={kitchenId} onChange={event => setKitchenId(event.target.value)} className={inputClass}>
            <option value="">Choose the kitchen…</option>
            {kitchens.map(kitchen => <option key={kitchen.id} value={kitchen.id}>{kitchen.name}</option>)}
          </select>
        </Field>
        <Field label="Needed on">
          <input type="date" value={neededOn} min={today} onChange={event => setNeededOn(event.target.value)} className={inputClass} />
          {lateHint && (
            <p className="mt-1 text-xs text-amber-700">
              Past the {cutoff} cut-off for this day — it will be marked Late; the kitchen may not manage it.
            </p>
          )}
        </Field>
      </div>

      <section>
        <h2 className="mb-1 text-lg font-semibold text-gray-800">What you need</h2>
        <p className="mb-3 text-sm text-gray-400">Requests for a day are due by {cutoff} the day before.</p>
        <div className="space-y-2">
          {lines.map(line => {
            const good = finishedGoods.find(candidate => candidate.id === line.finishedGoodId)
            return (
              <div key={line.key} className="flex items-center gap-2">
                {/* inputClass is full width, so each field's width comes from its wrapper. */}
                <div className="min-w-0 flex-1">
                  <select
                    value={line.finishedGoodId}
                    onChange={event => updateLine(line.key, { finishedGoodId: event.target.value })}
                    className={inputClass}
                    aria-label="Finished good"
                  >
                    <option value="">Choose a finished good…</option>
                    {finishedGoods.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                  </select>
                </div>
                <div className="w-32 shrink-0">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={event => updateLine(line.key, { quantity: event.target.value })}
                    className={inputClass}
                    placeholder="0"
                    aria-label="Quantity"
                  />
                </div>
                <span className="w-8 text-xs text-gray-500">{good?.unitAbbreviation}</span>
                <button
                  type="button"
                  title="Remove line"
                  onClick={() => setLines(current => current.length === 1 ? current : current.filter(l => l.key !== line.key))}
                  disabled={lines.length === 1}
                  className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600 disabled:opacity-30"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            )
          })}
        </div>
        <button
          type="button"
          onClick={() => { setLines(current => [...current, { key: nextKey, finishedGoodId: '', quantity: '' }]); setNextKey(key => key + 1) }}
          disabled={lines.length >= maxLines}
          className="mt-2 flex items-center gap-1 text-sm font-medium text-orange-600 hover:text-orange-700 disabled:opacity-40"
        >
          <Plus size={15} /> Add a finished good
        </button>
      </section>

      <Field label="Notes">
        <textarea
          rows={2}
          value={notes}
          onChange={event => setNotes(event.target.value)}
          placeholder="An event, a big order, when you need it delivered…"
          className={inputClass}
        />
      </Field>

      {fieldErrors.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {fieldErrors.map(message => <li key={message}>{message}</li>)}
        </ul>
      )}
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={incomplete || fieldErrors.length > 0 || submitting} className={primaryButtonClass}>
          {submitting ? 'Sending…' : 'Send to the kitchen'}
        </button>
        <Link href="/inventory/requests" className={secondaryButtonClass}>Cancel</Link>
        <span className="text-xs text-gray-400">No approval — the kitchen plans it, or tells you why not.</span>
      </div>
    </form>
  )
}
