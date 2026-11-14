'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { Field, inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'
import { ExpiryBadge } from '@/components/inventory/ExpiryBadge'
import { formatPeso, formatQuantity } from '@/lib/format'
// Type-only, so nothing from the service (or Prisma behind it) is bundled into
// the browser.
import type {
  TransferFormDto,
  TransferLinePlanDto,
  TransferPreviewDto,
} from '@/services/stock-transfer.service'

type Line = { key: number; finishedGoodId: string; quantity: string }

type Props = TransferFormDto & { maxLines: number }

const QUANTITY_PATTERN = /^\d+(\.\d+)?$/
const PREVIEW_DELAY_MS = 300

function positive(value: string): boolean {
  return QUANTITY_PATTERN.test(value.trim()) && Number(value) > 0
}

/**
 * The preview's query string, or null until a sender is chosen. A line is
 * sent once it has a good; its quantity only once it parses, so what is on
 * hand shows before anything is typed.
 */
function previewQuery(fromBranchId: string, lines: Line[]): string | null {
  if (!fromBranchId) return null
  const query = new URLSearchParams({ from: fromBranchId })
  for (const line of lines) {
    if (!line.finishedGoodId) continue
    query.append('line', positive(line.quantity) ? `${line.finishedGoodId}:${line.quantity.trim()}` : line.finishedGoodId)
  }
  return query.toString()
}

type PreviewResult = { query: string; data: TransferPreviewDto } | { query: string; error: string }

/**
 * Records a Transfer Order (Week 8 Task 2): the kitchen picks the goods and
 * quantities to send from a commissary to a branch. Lots are taken soonest
 * expiry first (T7) — shown here, chosen for good when accounting approves.
 * Submitting sends it straight to accounting; there is no draft (T6). The
 * server checks everything again.
 */
export function TransferOrderForm({ fromBranches, toBranches, finishedGoods, maxLines }: Props) {
  const router = useRouter()
  const [fromBranchId, setFrom] = useState(fromBranches[0]?.id ?? '')
  const [toBranchId, setTo]     = useState('')
  const [notes, setNotes]       = useState('')
  const [lines, setLines]       = useState<Line[]>([{ key: 1, finishedGoodId: '', quantity: '' }])
  const [nextKey, setNextKey]   = useState(2)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const destinations = toBranches.filter(branch => branch.id !== fromBranchId)

  function updateLine(key: number, patch: Partial<Line>) {
    setLines(current => current.map(line => line.key === key ? { ...line, ...patch } : line))
  }
  function addLine() {
    setLines(current => [...current, { key: nextKey, finishedGoodId: '', quantity: '' }])
    setNextKey(key => key + 1)
  }
  function removeLine(key: number) {
    setLines(current => current.length === 1 ? current : current.filter(line => line.key !== key))
  }
  function changeFrom(id: string) {
    setFrom(id)
    if (id === toBranchId) setTo('')
  }

  // Loading is derived — the result answers an older query — so the effect
  // only ever writes a finished answer (as in ConversionOrderForm).
  const query = previewQuery(fromBranchId, lines)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const previewLoading = query !== null && preview?.query !== query

  useEffect(() => {
    if (query === null) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/transfers/preview?${query}`, { signal: controller.signal })
        const body = await response.json().catch(() => null)
        setPreview(response.ok
          ? { query, data: body.preview }
          : { query, error: body?.error ?? `Request failed (${response.status})` })
      } catch {
        if (!controller.signal.aborted) setPreview({ query, error: 'Could not reach the server' })
      }
    }, PREVIEW_DELAY_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const data = preview !== null && 'data' in preview ? preview.data : null
  const stockOf = new Map(data?.stock.map(row => [row.finishedGoodId, row]) ?? [])
  const planOf  = new Map<string, TransferLinePlanDto>(data?.lines.map(row => [row.finishedGoodId, row]) ?? [])

  const chosen = lines.map(line => line.finishedGoodId).filter(Boolean)
  const fieldErrors: string[] = []
  if (new Set(chosen).size !== chosen.length) fieldErrors.push('Each finished good may appear on one line only — add the quantities together.')
  for (const line of lines) {
    if (line.quantity !== '' && !positive(line.quantity)) {
      const name = finishedGoods.find(good => good.id === line.finishedGoodId)?.name ?? 'A line'
      fieldErrors.push(`${name}: the quantity must be a number greater than zero.`)
    }
  }

  // The server refuses these too; the current answer says it before the click.
  const current     = preview !== null && preview.query === query && data !== null
  const anyShort    = current && data.lines.some(line => !line.enough)
  const incomplete  = !fromBranchId || !toBranchId || lines.some(line => !line.finishedGoodId || !line.quantity)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      // The submitter is deliberately absent: the server takes it from x-user-id.
      const response = await fetch('/api/transfers', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          fromBranchId,
          toBranchId,
          notes: notes || null,
          lines: lines.map(line => ({ finishedGoodId: line.finishedGoodId, quantity: line.quantity.trim() })),
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        setError(body?.error ?? `Request failed (${response.status})`)
        return
      }
      router.push(`/inventory/transfers/${body.transfer.id}`)
      router.refresh()
    } catch {
      setError('Could not reach the server')
    } finally {
      setSubmitting(false)
    }
  }

  if (fromBranches.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
        <p className="text-sm font-medium text-gray-600">No active commissary</p>
        <p className="mt-1 text-sm text-gray-400">Transfers are sent from a commissary — set one up in Master Data → Branches.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From (commissary)">
          <select value={fromBranchId} onChange={event => changeFrom(event.target.value)} className={inputClass}>
            {fromBranches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </Field>
        <Field label="To">
          <select value={toBranchId} onChange={event => setTo(event.target.value)} className={inputClass}>
            <option value="">Choose the receiving branch…</option>
            {destinations.map(branch => (
              <option key={branch.id} value={branch.id}>
                {branch.name}{branch.type === 'COMMISSARY' ? ' (commissary)' : ''}
              </option>
            ))}
          </select>
          {destinations.length === 0 && (
            <p className="mt-1 text-xs text-amber-700">No other active branch — add one in Master Data → Branches.</p>
          )}
        </Field>
      </div>

      <section>
        <h2 className="mb-1 text-lg font-semibold text-gray-800">What to send</h2>
        <p className="mb-3 text-sm text-gray-400">
          Lots are taken soonest expiry first; expired lots are never sent. Nothing moves until accounting approves.
          {previewLoading && preview !== null && ' Updating…'}
        </p>

        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Finished good</th>
                <th className="w-36 px-3 py-2 font-medium">Quantity</th>
                <th className="px-3 py-2 text-right font-medium">Available</th>
                <th className="px-3 py-2 font-medium">Lots it takes</th>
                <th className="px-3 py-2 text-right font-medium">Value at cost</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className={`divide-y divide-gray-100 ${previewLoading && preview !== null ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
              {lines.map(line => {
                const good  = finishedGoods.find(candidate => candidate.id === line.finishedGoodId)
                const stock = line.finishedGoodId ? stockOf.get(line.finishedGoodId) : undefined
                const plan  = positive(line.quantity) ? planOf.get(line.finishedGoodId) : undefined
                return (
                  <tr key={line.key} className={plan && !plan.enough ? 'bg-red-50/60' : ''}>
                    <td className="px-3 py-2 align-top">
                      <select
                        value={line.finishedGoodId}
                        onChange={event => updateLine(line.key, { finishedGoodId: event.target.value })}
                        className={inputClass}
                      >
                        <option value="">Choose…</option>
                        {finishedGoods.map(candidate => {
                          const at = stockOf.get(candidate.id)
                          return (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.name}{at ? ` — ${formatQuantity(at.available)} ${at.unitAbbreviation} available` : ''}
                            </option>
                          )
                        })}
                      </select>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={line.quantity}
                          onChange={event => updateLine(line.key, { quantity: event.target.value })}
                          className={inputClass}
                          placeholder="0"
                        />
                        <span className="text-xs text-gray-500">{good?.unitAbbreviation}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right align-top tabular-nums">
                      {stock ? (
                        <>
                          <span className={Number(stock.available) > 0 ? 'text-gray-800' : 'text-red-600'}>
                            {formatQuantity(stock.available)} {stock.unitAbbreviation}
                          </span>
                          {(Number(stock.claimed) > 0 || Number(stock.expiredOnHand) > 0) && (
                            <span className="block text-xs text-gray-400">
                              {formatQuantity(stock.unexpiredOnHand)} on hand
                              {Number(stock.claimed) > 0 && <> · {formatQuantity(stock.claimed)} claimed</>}
                              {Number(stock.expiredOnHand) > 0 && <> · {formatQuantity(stock.expiredOnHand)} expired</>}
                            </span>
                          )}
                        </>
                      ) : line.finishedGoodId ? <span className="text-gray-400">…</span> : null}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {plan && (
                        <>
                          {plan.lots.map(lot => (
                            <span key={lot.lotNumber} className="flex items-center gap-1.5 whitespace-nowrap text-xs text-gray-600">
                              <span className="font-mono">{lot.lotNumber}</span>
                              <span>{formatQuantity(lot.take)} {plan.unitAbbreviation}</span>
                              <ExpiryBadge flag={lot.expiry} />
                            </span>
                          ))}
                          {!plan.enough && (
                            <span className="mt-1 block text-xs font-medium text-red-700">
                              Short {formatQuantity(plan.short)} {plan.unitAbbreviation}
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right align-top tabular-nums text-gray-800">
                      {plan?.value != null ? formatPeso(plan.value) : plan ? <span className="text-gray-400">—</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      <button
                        type="button"
                        title="Remove line"
                        onClick={() => removeLine(line.key)}
                        disabled={lines.length === 1}
                        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600 disabled:opacity-30"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {data?.totalValue != null && current && (
              <tfoot className="border-t border-gray-200 bg-gray-50">
                <tr>
                  <td colSpan={4} className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Total value at cost</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-800">{formatPeso(data.totalValue)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <button
          type="button"
          onClick={addLine}
          disabled={lines.length >= maxLines}
          className="mt-2 flex items-center gap-1 text-sm font-medium text-orange-600 hover:text-orange-700 disabled:opacity-40"
        >
          <Plus size={15} /> Add a finished good
        </button>

        {preview !== null && 'error' in preview && (
          <p className="mt-2 text-sm text-red-600">{preview.error}</p>
        )}
        {data !== null && data.stock.length === 0 && (
          <p className="mt-2 text-sm text-amber-700">{data.fromBranch.name} has no finished goods on hand.</p>
        )}
      </section>

      <Field label="Notes">
        <textarea
          rows={2}
          value={notes}
          onChange={event => setNotes(event.target.value)}
          placeholder="Delivery run, driver, anything accounting or the branch should know…"
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
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={incomplete || fieldErrors.length > 0 || anyShort || submitting}
          className={primaryButtonClass}
        >
          {submitting ? 'Submitting…' : 'Submit for approval'}
        </button>
        <Link href="/inventory/transfers" className={secondaryButtonClass}>Cancel</Link>
        <span className="text-xs text-gray-400">Submitting sends it to accounting — there is no draft.</span>
      </div>
    </form>
  )
}
