import Link from 'next/link'
import { shortDateLabel } from '@/lib/dates'
import { formatPeso, formatQuantity, formatSignedPeso, trimDecimal } from '@/lib/format'
// Type-only: rendered on the server, for the order page.
import type { CostComparisonDto, IngredientChangeDto } from '@/services/cost-variance.service'
import type { AiInsightDto } from '@/services/ai.service'
import { AiInsightPanel } from '@/components/ai/AiInsightPanel'

/** Dearer is red, cheaper green, as on the costing dashboard. */
function changeClass(value: string): string {
  if (value.startsWith('-')) return 'text-emerald-700'
  return Number(value) === 0 ? 'text-gray-500' : 'text-red-700'
}

function signedPercent(value: string): string {
  const fixed = Number(value).toFixed(1)
  return value.startsWith('-') ? `−${fixed.slice(1)}%` : Number(value) === 0 ? '±0.0%' : `+${fixed}%`
}

/** Yields side by side read better at the same precision: "90.0%" next to "96.9%". */
function yieldPercent(value: string): string {
  return `${Number(value).toFixed(1)}%`
}

function nowAndThen(now: string | null, then: string | null, format: (value: string) => string) {
  return (
    <>
      <span className="text-gray-800">{now === null ? '—' : format(now)}</span>
      <span className="text-gray-400"> / {then === null ? '—' : format(then)}</span>
    </>
  )
}

function IngredientRows({ rows, unit }: { rows: IngredientChangeDto[]; unit: string }) {
  return rows.map(row => (
    <tr key={row.materialId} className="align-top">
      <td className="py-1.5 pr-3 text-gray-800">
        {row.materialName}
        {row.presence !== 'BOTH' && (
          <span className="ml-1 rounded bg-gray-100 px-1 text-xs text-gray-500">{row.presence === 'ADDED' ? 'new in recipe' : 'no longer used'}</span>
        )}
      </td>
      <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">
        {nowAndThen(row.usagePerUnit, row.previousUsagePerUnit, value => `${formatQuantity(value)} ${row.unitAbbreviation}`)}
      </td>
      <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">
        {nowAndThen(row.unitPrice, row.previousUnitPrice, value => `${formatPeso(value)}/${row.unitAbbreviation}`)}
      </td>
      <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">
        {nowAndThen(row.costPerUnit, row.previousCostPerUnit, value => `${formatPeso(value)}/${unit}`)}
      </td>
      <td className={`whitespace-nowrap py-1.5 pr-3 text-right font-medium tabular-nums ${changeClass(row.change)}`}>{formatSignedPeso(row.change)}</td>
      <td className={`whitespace-nowrap py-1.5 pr-3 text-right tabular-nums ${changeClass(row.priceEffect)}`}>{formatSignedPeso(row.priceEffect)}</td>
      <td className={`whitespace-nowrap py-1.5 text-right tabular-nums ${changeClass(row.usageEffect)}`}>{formatSignedPeso(row.usageEffect)}</td>
    </tr>
  ))
}

/**
 * FEATURE 1 — why this batch cost what it did (Week 9 Task 2, E5): the cost
 * per unit against the previous run of the same good (or, for its first run,
 * against its plan), split into what prices and what usage / yield did, and
 * each ingredient's part. Every figure is the service's, in Decimal; this
 * only formats. Claude's explanation sits on top of these figures.
 */
/** `canExplain`: the viewer may ask for, or regenerate, the explanation (AiInsightService.canGenerate). */
export function CostVarianceCard({ comparison, insight, canExplain }: { comparison: CostComparisonDto; insight: AiInsightDto | null; canExplain: boolean }) {
  const { current, previous, unitAbbreviation: unit, ingredients } = comparison

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">
        Why this batch cost what it did
      </p>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-2xl font-bold text-gray-800">{formatPeso(current.costPerUnit)}<span className="text-base font-medium text-gray-500">/{unit}</span></p>
        <p className={`text-lg font-semibold ${changeClass(comparison.change)}`}>
          {formatSignedPeso(comparison.change)}/{unit} ({signedPercent(comparison.percentChange)})
        </p>
        <p className="text-sm text-gray-500">
          {previous ? (
            <>
              vs <Link href={`/production/orders/${previous.productionOrderId}`} className="font-medium text-orange-600 hover:underline">{previous.orderNumber}</Link>
              {' '}on {shortDateLabel(previous.producedOn)} ({formatPeso(previous.costPerUnit)}/{unit})
            </>
          ) : (
            <>vs its plan ({formatPeso(comparison.basisCostPerUnit)}/{unit}) — the first {comparison.finishedGoodName} batch on record</>
          )}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <span className="rounded-lg bg-gray-50 px-2.5 py-1">
          Ingredient prices <span className={`font-medium ${changeClass(comparison.priceEffect)}`}>{formatSignedPeso(comparison.priceEffect)}/{unit}</span>
        </span>
        <span className="rounded-lg bg-gray-50 px-2.5 py-1">
          {previous ? 'Usage and yield' : 'Yield'} <span className={`font-medium ${changeClass(comparison.usageEffect)}`}>{formatSignedPeso(comparison.usageEffect)}/{unit}</span>
        </span>
      </div>

      <p className="mt-3 text-sm text-gray-600">
        Yield {yieldPercent(current.yieldPercent)} of plan ({trimDecimal(current.actualQty)} of {trimDecimal(current.plannedQty)} {unit})
        {previous && <> — last time {yieldPercent(previous.yieldPercent)} ({trimDecimal(previous.actualQty)} of {trimDecimal(previous.plannedQty)} {unit})</>}
        {' · '}Recipe v{current.bomVersion}
        {previous && (comparison.recipeChanged ? <>, changed from v{previous.bomVersion}</> : <>, same as last time</>)}
      </p>

      {/* Claude's explanation (Week 9 Task 2, E5), in the shared panel with Regenerate (Week 10 Task 2). */}
      <div className="mt-4 rounded-lg border border-purple-100 bg-purple-50/40 px-3 py-2">
        <AiInsightPanel
          insight={insight}
          type="COST_VARIANCE"
          referenceId={current.productionOrderId}
          canGenerate={canExplain}
          title="AI explanation"
          empty="No explanation yet."
          firstLabel="Explain this batch"
          writing="Claude is explaining this batch…"
          checkHint="Check it against the figures above."
          costHint="Costs less than a cent."
        >
          <p className="whitespace-pre-wrap text-sm text-gray-800">{insight?.content}</p>
        </AiInsightPanel>
      </div>

      {ingredients.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Ingredient</th>
                <th className="py-1.5 pr-3 font-medium">Used per {unit} <span className="normal-case text-gray-300">now / last</span></th>
                <th className="py-1.5 pr-3 font-medium">Price <span className="normal-case text-gray-300">now / last</span></th>
                <th className="py-1.5 pr-3 font-medium">Cost per {unit} <span className="normal-case text-gray-300">now / last</span></th>
                <th className="py-1.5 pr-3 text-right font-medium">Change</th>
                <th className="py-1.5 pr-3 text-right font-medium">From price</th>
                <th className="py-1.5 text-right font-medium">From usage</th>
              </tr>
            </thead>
            {/* The service sorts them: what moved the cost most comes first. */}
            <tbody className="divide-y divide-gray-100">
              <IngredientRows rows={ingredients} unit={unit} />
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
