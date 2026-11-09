import { formatPeso, formatSignedPeso, trimDecimal } from '@/lib/format'
// Type-only: rendered on the server, for the order page.
import type { CompletionEffectDto, CostingDto } from '@/services/production-order.service'

/**
 * What approving a reported completion will do to the books, shown above the
 * approve / reject controls (Week 6 Task 2, D8): every ingredient that comes
 * off at the branch with the stock it leaves, and the lot that goes on.
 * Going below zero is allowed (D3) but each such line is called out.
 */
export function CompletionReview({
  effect, finishedGoodName, costing,
}: {
  effect: CompletionEffectDto
  finishedGoodName: string
  /** What approving records as the run's cost (Week 6 Task 3); the Costing card has the breakdown. */
  costing: CostingDto | null
}) {
  const { ingredients, negativeCount, lot } = effect
  const actual  = costing?.actual ?? null
  const missing = [...new Set([...(costing?.planned.missing ?? []), ...(actual?.missing ?? [])])]

  return (
    <div className="mb-3 rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-1 text-sm font-semibold text-gray-800">Approving this completion</p>
      <p className="mb-3 text-sm text-gray-500">
        Deducts {ingredients.length} {ingredients.length === 1 ? 'ingredient' : 'ingredients'} at {lot.branchName} (the BOM at
        the planned quantity) and adds{' '}
        <span className="font-medium text-emerald-700">+{trimDecimal(lot.quantity)} {lot.unitAbbreviation} {finishedGoodName}</span>
        {' '}as lot <span className="font-mono">{lot.lotNumber}</span>.
      </p>

      {actual?.total && actual.perUnit && (
        <p className="mb-3 text-sm text-gray-700">
          Records a batch cost of <span className="font-medium">{formatPeso(actual.total)}</span> —{' '}
          <span className="font-medium">{formatPeso(actual.perUnit)}/{lot.unitAbbreviation}</span> for{' '}
          {trimDecimal(actual.yield)} {lot.unitAbbreviation}
          {costing?.planned.perUnit && <> (planned {formatPeso(costing.planned.perUnit)}/{lot.unitAbbreviation})</>}
          {costing?.variance && <>, a variance of {formatSignedPeso(costing.variance)}</>}.
          {' '}The Costing card below has the breakdown.
        </p>
      )}
      {missing.length > 0 && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Approving will be refused: there is no reference price for {missing.join(', ')}, so the cost cannot be
          recorded. An admin adds one in Master Data (it may be back-dated); you can still reject.
        </p>
      )}

      {negativeCount > 0 && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {negativeCount} of {ingredients.length} {ingredients.length === 1 ? 'ingredient' : 'ingredients'} will go below
          zero. That is allowed — the kitchen used them — but it means stock was used that the books never received:
          a delivery or adjustment is missing.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="py-2 pr-4 font-medium">Ingredient</th>
              <th className="py-2 pr-4 text-right font-medium">Deduct</th>
              <th className="py-2 pr-4 text-right font-medium">On hand now</th>
              <th className="py-2 text-right font-medium">After approval</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {ingredients.map(line => (
              <tr key={line.materialId} className={line.goesNegative ? 'bg-red-50/60' : undefined}>
                <td className="py-1.5 pr-4 text-gray-700">
                  {line.materialName} <span className="font-mono text-xs text-gray-400">{line.materialCode}</span>
                </td>
                <td className="py-1.5 pr-4 text-right text-gray-700">
                  −{trimDecimal(line.deduct)} <span className="text-gray-400">{line.unitAbbreviation}</span>
                </td>
                <td className="py-1.5 pr-4 text-right text-gray-500">{trimDecimal(line.onHand)}</td>
                <td className={`py-1.5 text-right font-medium ${line.goesNegative ? 'text-red-700' : 'text-gray-800'}`}>
                  {trimDecimal(line.after)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
