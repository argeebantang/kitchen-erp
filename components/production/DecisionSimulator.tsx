'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, Trash2 } from 'lucide-react'
import { formatPeso, formatUsd, trimDecimal } from '@/lib/format'
// Type-only, so nothing from the services is bundled into the browser.
import type { SimulationDto, SimulatorGoodDto } from '@/services/decision-simulator.service'
import { AiBadge } from '@/components/ai/AiBadge'
import { STATUS_STYLES } from '@/components/inventory/StockTile'
import { IconButton, inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'

type Line = { key: number; finishedGoodId: string; batches: string }
type Explanation = { text: string; model: string; costUsd: string }

let nextKey = 0
const lineOf = (finishedGoodId = '', batches = '1'): Line => ({ key: nextKey++, finishedGoodId, batches })

/**
 * FEATURE 7 — the Decision Simulator on Production → Plan (Week 10 Task 6):
 * "what if we cook these batches that day?" against the live recipes, stock
 * and prices. Nothing is saved; a line can be turned into a real production
 * order. KitchenAI explains the outcome on request.
 */
export function DecisionSimulator({ kitchen, date, goods, initial, canExplain, canOrder }: {
  kitchen: { id: string; name: string }
  date: string
  goods: SimulatorGoodDto[]
  /** The plan's batches (Feature 5), as a starting point. */
  initial: { finishedGoodId: string; batches: number }[]
  canExplain: boolean
  canOrder: boolean
}) {
  const fromPlan = () => (initial.length > 0 ? initial.map(line => lineOf(line.finishedGoodId, String(line.batches))) : [lineOf()])
  const [lines, setLines] = useState<Line[]>(fromPlan)
  const [result, setResult] = useState<SimulationDto | null>(null)
  const [explanation, setExplanation] = useState<Explanation | null>(null)
  const [busy, setBusy] = useState<'simulate' | 'explain' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const goodById = new Map(goods.map(good => [good.id, good]))

  function update(key: number, patch: Partial<Line>) {
    setLines(current => current.map(line => (line.key === key ? { ...line, ...patch } : line)))
  }

  async function run(explain: boolean) {
    setError(null)
    const filled = lines.filter(line => line.finishedGoodId)
    if (filled.length === 0) { setError('Pick at least one good.'); return }
    if (filled.some(line => !/^\d+$/.test(line.batches) || Number(line.batches) < 1)) { setError('Batches are whole numbers, 1 or more.'); return }
    setBusy(explain ? 'explain' : 'simulate')
    try {
      const response = await fetch('/api/production/simulate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          kitchenId: kitchen.id, date, explain,
          lines: filled.map(line => ({ finishedGoodId: line.finishedGoodId, batches: Number(line.batches) })),
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) { setError(body?.error ?? `Could not simulate (${response.status})`); return }
      setResult(body.simulation)
      setExplanation(body.explanation)
      if (explain && !body.explanation) setError(`The simulation is below, but KitchenAI could not explain it: ${body.explainError ?? 'unknown error'}`)
    } catch {
      setError('Could not reach the server')
    } finally {
      setBusy(null)
    }
  }

  const used = new Set(lines.map(line => line.finishedGoodId))

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="text-base font-semibold text-gray-800">Simulate a run</h3>
      <p className="text-xs text-gray-400">
        What if {kitchen.name} cooks these batches on this day? Checked against the recipes, the stock free now (on hand less
        what approved runs still need) and the reference prices. Nothing is saved.
      </p>

      <div className="mt-3 space-y-2">
        {lines.map(line => {
          const good = goodById.get(line.finishedGoodId)
          return (
            <div key={line.key} className="flex flex-wrap items-end gap-2">
              <label className="block min-w-48 flex-1">
                <span className="mb-1 block text-xs font-medium text-gray-500">Good</span>
                <select value={line.finishedGoodId} onChange={event => update(line.key, { finishedGoodId: event.target.value })} className={inputClass}>
                  <option value="">Choose a good…</option>
                  {goods.map(option => (
                    <option key={option.id} value={option.id} disabled={option.id !== line.finishedGoodId && used.has(option.id)}>
                      {option.name} ({trimDecimal(option.batchSize)} {option.unit} a batch)
                    </option>
                  ))}
                </select>
              </label>
              <label className="block w-28">
                <span className="mb-1 block text-xs font-medium text-gray-500">Batches</span>
                <input type="number" min={1} max={50} value={line.batches} onChange={event => update(line.key, { batches: event.target.value })} className={inputClass} />
              </label>
              <span className="pb-2 text-xs text-gray-400">
                {good && /^\d+$/.test(line.batches) ? `= ${trimDecimal(String(Number(good.batchSize) * Number(line.batches)))} ${good.unit}` : ''}
              </span>
              <div className="pb-1.5">
                <IconButton title="Remove" onClick={() => setLines(current => (current.length > 1 ? current.filter(l => l.key !== line.key) : [lineOf()]))}>
                  <Trash2 size={16} />
                </IconButton>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setLines(current => [...current, lineOf()])} disabled={lines.length >= 8 || lines.length >= goods.length}
          className="inline-flex items-center gap-1 text-sm font-medium text-orange-600 hover:text-orange-700 disabled:opacity-40">
          <Plus size={15} /> Add a good
        </button>
        {initial.length > 0 && (
          <button type="button" onClick={() => setLines(fromPlan())} className="text-sm text-gray-500 hover:underline">Reset to the plan above</button>
        )}
        <span className="flex-1" />
        <button type="button" onClick={() => run(false)} disabled={busy !== null} className={secondaryButtonClass}>
          {busy === 'simulate' ? 'Simulating…' : 'Simulate'}
        </button>
        {canExplain && (
          <button type="button" onClick={() => run(true)} disabled={busy !== null} className={`${primaryButtonClass} inline-flex items-center gap-1.5`}>
            {busy === 'explain' ? 'Asking KitchenAI…' : 'Simulate and ask KitchenAI'}
          </button>
        )}
      </div>
      {canExplain && <p className="mt-1 text-right text-xs text-gray-400">Simulate is free; asking KitchenAI costs about a cent and takes a few seconds.</p>}
      {error && <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {result && <Outcome result={result} explanation={explanation} canOrder={canOrder} />}
    </section>
  )
}

function Outcome({ result, explanation, canOrder }: { result: SimulationDto; explanation: Explanation | null; canOrder: boolean }) {
  const { totals } = result
  return (
    <div className="mt-5 space-y-4 border-t border-gray-100 pt-4">
      <p className={`rounded-lg px-3 py-2 text-sm font-medium ${result.feasible ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
        {result.feasible
          ? `It can run with the stock free now${totals.lowAfter > 0 ? `, but ${totals.lowAfter} ingredient${totals.lowAfter === 1 ? '' : 's'} would end at or below the reorder point` : ''}.`
          : `${totals.shortIngredients} ingredient${totals.shortIngredients === 1 ? ' is' : 's are'} short — see below.`}
        {' '}Total {totals.cost === null ? 'cost unknown (no price for ' + totals.missingPrices.join(', ') + ')' : formatPeso(totals.cost)}
        {totals.costPerUnit && <> · {formatPeso(totals.costPerUnit)} per kg planned</>}
      </p>

      {explanation && (
        <div className="rounded-lg border border-purple-100 bg-purple-50/40 px-3 py-3">
          <p className="flex items-center gap-2 text-xs font-medium text-purple-700"><AiBadge /> KitchenAI on this run</p>
          <p className="mt-1 whitespace-pre-line text-sm text-gray-800">{explanation.text}</p>
          <p className="mt-1 text-xs text-gray-400">
            By <span className="font-mono">{explanation.model}</span> · {formatUsd(explanation.costUsd, 4)} · not saved — the figures are the system&apos;s.
          </p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-gray-400">
            <tr>
              <th className="py-1.5 pr-3 font-medium">Good</th>
              <th className="py-1.5 pr-3 text-right font-medium">Planned</th>
              <th className="py-1.5 pr-3 text-right font-medium">Cost</th>
              <th className="py-1.5 pr-3 text-right font-medium">Per kg planned</th>
              <th className="py-1.5 pr-3 text-right font-medium">Yield → out</th>
              <th className="py-1.5 pr-3 text-right font-medium">Per kg out</th>
              <th className="py-1.5 pr-3 text-right font-medium">Most batches the stock allows</th>
              {canOrder && <th className="py-1.5 font-medium" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {result.lines.map(line => (
              <tr key={line.finishedGoodId} className="align-top">
                <td className="py-2 pr-3 font-medium text-gray-800">{line.name} <span className="block text-xs font-normal text-gray-400">recipe v{line.bomVersion}</span></td>
                <td className="py-2 pr-3 text-right text-gray-700">{line.batches} × {trimDecimal(line.batchSize)} = {trimDecimal(line.plannedQty)} {line.unit}</td>
                <td className="py-2 pr-3 text-right text-gray-700">{line.cost === null ? '—' : formatPeso(line.cost)}</td>
                <td className="py-2 pr-3 text-right text-gray-700">{line.costPerUnit === null ? '—' : formatPeso(line.costPerUnit)}</td>
                <td className="py-2 pr-3 text-right text-gray-700">
                  {line.yieldPercent === null ? '100 %' : `${line.yieldPercent} %`}
                  <span className="block text-xs text-gray-400">{trimDecimal(line.expectedOutput)} {line.unit}</span>
                </td>
                <td className="py-2 pr-3 text-right font-medium text-gray-800">{line.costPerExpectedUnit === null ? '—' : formatPeso(line.costPerExpectedUnit)}</td>
                <td className={`py-2 pr-3 text-right ${line.maxBatches < line.batches ? 'font-semibold text-red-700' : 'text-gray-700'}`}>
                  {line.maxBatches >= 99 ? '99+' : line.maxBatches}
                </td>
                {canOrder && (
                  <td className="py-2 text-right">
                    <Link
                      href={`/production/orders/new?${new URLSearchParams({ date: result.date, good: line.finishedGoodId, branch: result.kitchen.id, batches: String(line.batches) })}`}
                      className="whitespace-nowrap text-sm font-medium text-orange-600 hover:underline"
                    >
                      Create order →
                    </Link>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Ingredients</p>
        <table className="mt-1 w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-gray-400">
            <tr>
              <th className="py-1.5 pr-3 font-medium">Ingredient</th>
              <th className="py-1.5 pr-3 text-right font-medium">Needs</th>
              <th className="py-1.5 pr-3 text-right font-medium">Free now</th>
              <th className="py-1.5 pr-3 text-right font-medium">Short</th>
              <th className="py-1.5 pr-3 text-right font-medium">After the run</th>
              <th className="py-1.5 pr-3 text-right font-medium">Cost</th>
              <th className="py-1.5 font-medium">Used by</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {result.ingredients.map(row => (
              <tr key={row.materialId} className={row.short !== '0' ? 'bg-red-50/50' : ''}>
                <td className="py-1.5 pr-3 text-gray-800">{row.name}</td>
                <td className="py-1.5 pr-3 text-right text-gray-700">{trimDecimal(row.need)} {row.unit}</td>
                <td className="py-1.5 pr-3 text-right text-gray-700">
                  {trimDecimal(row.free)}
                  {row.committed !== '0' && <span className="block text-xs text-gray-400">{trimDecimal(row.onHand)} on hand − {trimDecimal(row.committed)} approved runs</span>}
                </td>
                <td className={`py-1.5 pr-3 text-right ${row.short !== '0' ? 'font-semibold text-red-700' : 'text-gray-400'}`}>{row.short === '0' ? '—' : `${trimDecimal(row.short)} ${row.unit}`}</td>
                <td className="py-1.5 pr-3 text-right">
                  <span className="text-gray-700">{trimDecimal(row.after)}</span>{' '}
                  {(row.afterStatus === 'OUT' || row.afterStatus === 'LOW') && (
                    <span className={`rounded border px-1 py-0.5 text-xs ${STATUS_STYLES[row.afterStatus].badgeClass}`}>{STATUS_STYLES[row.afterStatus].label}</span>
                  )}
                  <span className="block text-xs text-gray-400">reorder at {trimDecimal(row.reorderPoint)}</span>
                </td>
                <td className="py-1.5 pr-3 text-right text-gray-700">{row.cost === null ? 'no price' : formatPeso(row.cost)}</td>
                <td className="py-1.5 text-xs text-gray-500">{row.usedBy.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
