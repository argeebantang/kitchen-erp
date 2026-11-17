import Link from 'next/link'
import { shortDateLabel } from '@/lib/dates'
import { formatPeso, formatQuantity, formatSignedPeso } from '@/lib/format'
import type { ExpensiveBatchDto } from '@/services/costing.service'

/**
 * The range's costliest signed-off runs (Week 8 Task 6, C9), most expensive
 * first, with what a unit cost and how far the run went over or under plan.
 * The order number opens the order for roles that may. Rendered on the server.
 */
export function ExpensiveBatches({ batches }: { batches: ExpensiveBatchDto[] }) {
  if (batches.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
        No batch was signed off in these weeks.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
          <tr>
            <th className="px-3 py-2 text-right font-medium">#</th>
            <th className="px-3 py-2 text-left font-medium">Batch</th>
            <th className="px-3 py-2 text-left font-medium">Finished good</th>
            <th className="px-3 py-2 text-left font-medium">Cooked</th>
            <th className="px-3 py-2 text-right font-medium">Made</th>
            <th className="px-3 py-2 text-right font-medium">Cost</th>
            <th className="px-3 py-2 text-right font-medium">Per unit</th>
            <th className="px-3 py-2 text-right font-medium" title="What it cost beyond what that much should have cost at plan">vs plan</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {batches.map((batch, index) => {
            const over = !batch.costVariance.startsWith('-') && Number(batch.costVariance) !== 0
            return (
              <tr key={batch.id}>
                <td className="px-3 py-2 text-right tabular-nums text-gray-400">{index + 1}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {batch.href ? (
                    <Link href={batch.href} className="font-mono text-xs text-orange-600 hover:text-orange-700 hover:underline">{batch.orderNumber}</Link>
                  ) : (
                    <span className="font-mono text-xs text-gray-700">{batch.orderNumber}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-800">
                  {batch.finishedGoodName}
                  <span className="ml-1.5 text-xs text-gray-400">{batch.branchName}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{shortDateLabel(batch.producedOn)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-700">
                  {formatQuantity(batch.quantity)} {batch.unitAbbreviation}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums text-gray-900">{formatPeso(batch.cost)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-700">
                  {formatPeso(batch.costPerUnit)}<span className="text-xs text-gray-400">/{batch.unitAbbreviation}</span>
                </td>
                <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${over ? 'text-red-700' : 'text-emerald-700'}`}>
                  {formatSignedPeso(batch.costVariance)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
