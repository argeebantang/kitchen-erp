'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Field, inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'
import { trimDecimal } from '@/lib/format'
// Type-only, so nothing from the service (or Prisma behind it) is bundled into the browser.
import type { OutletSaleFormDto } from '@/services/outlet-sale.service'
import { EmptyState } from '@/components/ui/states'
import { Store } from 'lucide-react'

type Props = OutletSaleFormDto & { initialBranchId?: string }

const QUANTITY_PATTERN = /^\d+(\.\d+)?$/
const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })

/**
 * The day's sales at an outlet (Week 10 Task 1): one row per finished good,
 * with what is on the books to sell. No approval — saving takes the goods out
 * of the outlet's lots, soonest expiry first. The total is a preview at
 * today's selling prices; the server prices and checks stock again.
 */
export function OutletSaleForm({ outlets, today, yesterday, initialBranchId }: Props) {
  const router = useRouter()
  const [branchId, setBranchId] = useState(outlets.find(o => o.id === initialBranchId)?.id ?? outlets[0]?.id ?? '')
  const outlet = outlets.find(o => o.id === branchId)
  const firstOpenDay = [today, yesterday].find(day => !outlet?.recordedDays.includes(day)) ?? today
  const [soldOn, setSoldOn]       = useState(firstOpenDay)
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [notes, setNotes]         = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]         = useState<string | null>(null)

  if (!outlet) {
    return (
      <EmptyState icon={Store} title="No outlet to record for">
        Sales are recorded by an outlet&apos;s manager, and you do not run an active outlet.
      </EmptyState>
    )
  }

  const dayDone = outlet.recordedDays.includes(soldOn)
  const entered = outlet.goods
    .map(good => ({ good, value: (quantities[good.finishedGoodId] ?? '').trim() }))
    .filter(line => line.value !== '')
  const problems: string[] = []
  let total = 0
  for (const { good, value } of entered) {
    if (!QUANTITY_PATTERN.test(value) || Number(value) <= 0) {
      problems.push(`${good.name}: enter a number greater than zero, or leave it empty.`)
      continue
    }
    if (Number(value) > Number(good.available)) {
      problems.push(`${good.name}: ${value} ${good.unitAbbreviation} is more than the ${trimDecimal(good.available)} ${good.unitAbbreviation} on the books.`)
    }
    total += Number(value) * Number(good.sellingPrice)
  }

  function changeOutlet(id: string) {
    setBranchId(id)
    setQuantities({})
    const next = outlets.find(o => o.id === id)
    setSoldOn([today, yesterday].find(day => !next?.recordedDays.includes(day)) ?? today)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const response = await fetch('/api/outlet-sales', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          branchId, soldOn, notes: notes || null,
          lines: entered.map(({ good, value }) => ({ finishedGoodId: good.finishedGoodId, quantity: value })),
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        setError(body?.error ?? `Request failed (${response.status})`)
        return
      }
      router.push(`/inventory/sales/${body.sale.id}`)
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
        <Field label="Outlet">
          <select value={branchId} onChange={event => changeOutlet(event.target.value)} className={inputClass}>
            {outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Field>
        <Field label="Sold on">
          <select value={soldOn} onChange={event => setSoldOn(event.target.value)} className={inputClass}>
            <option value={today}>Today ({today}){outlet.recordedDays.includes(today) ? ' — recorded' : ''}</option>
            <option value={yesterday}>Yesterday ({yesterday}){outlet.recordedDays.includes(yesterday) ? ' — recorded' : ''}</option>
          </select>
          {dayDone && <p className="mt-1 text-xs text-amber-700">This day is already recorded for {outlet.name}.</p>}
        </Field>
      </div>

      <section>
        <h2 className="mb-1 text-lg font-semibold text-gray-800">What you sold</h2>
        <p className="mb-3 text-sm text-gray-400">Leave a good empty if none was sold. Expired stock cannot be sold — write it off instead.</p>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Finished good</th>
                <th className="px-4 py-2 text-right font-medium">On the books</th>
                <th className="px-4 py-2 text-right font-medium">Price</th>
                <th className="w-40 px-4 py-2 font-medium">Sold</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {outlet.goods.map(good => {
                const value  = quantities[good.finishedGoodId] ?? ''
                const amount = QUANTITY_PATTERN.test(value.trim()) ? Number(value) * Number(good.sellingPrice) : null
                const none   = Number(good.available) <= 0
                return (
                  <tr key={good.finishedGoodId} className={none ? 'text-gray-400' : ''}>
                    <td className="px-4 py-2">
                      <span className="font-medium text-gray-800">{good.name}</span>{' '}
                      <span className="font-mono text-xs text-gray-400">{good.code}</span>
                    </td>
                    <td className="px-4 py-2 text-right">{trimDecimal(good.available)} {good.unitAbbreviation}</td>
                    <td className="px-4 py-2 text-right">{peso.format(Number(good.sellingPrice))}/{good.unitAbbreviation}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={value}
                          disabled={none}
                          onChange={event => setQuantities(current => ({ ...current, [good.finishedGoodId]: event.target.value }))}
                          className={inputClass}
                          placeholder={none ? '—' : '0'}
                          aria-label={`${good.name} sold`}
                        />
                        <span className="w-6 text-xs text-gray-500">{good.unitAbbreviation}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right text-gray-700">{amount === null || value === '' ? '' : peso.format(amount)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 font-semibold text-gray-800">
                <td className="px-4 py-2" colSpan={4}>Takings at selling price</td>
                <td className="px-4 py-2 text-right">{peso.format(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <Field label="Notes">
        <textarea
          rows={2}
          value={notes}
          onChange={event => setNotes(event.target.value)}
          placeholder="A big order, a slow day, rain…"
          className={inputClass}
        />
      </Field>

      {problems.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {problems.map(message => <li key={message}>{message}</li>)}
        </ul>
      )}
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={entered.length === 0 || problems.length > 0 || dayDone || submitting} className={primaryButtonClass}>
          {submitting ? 'Saving…' : 'Record the sales'}
        </button>
        <Link href="/inventory/sales" className={secondaryButtonClass}>Cancel</Link>
        <span className="text-xs text-gray-400">No approval — the goods leave the outlet&apos;s stock when you save.</span>
      </div>
    </form>
  )
}
