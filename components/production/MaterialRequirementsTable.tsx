import { trimDecimal } from '@/lib/format'
// Type-only: this renders on the detail page (server) and inside
// ProductionOrderForm (client), so it must not pull the service in.
import type { MaterialRequirementDto } from '@/services/production-order.service'

/**
 * No 'use client' and no state, so it renders on the server for the detail
 * page and joins the client bundle only through the form that imports it.
 * Every figure arrives computed (Decimal, server-side), including whether a
 * line is covered; this only trims zeros.
 *
 * The stock columns appear when the lines carry a stock check — an order still
 * ahead of its run, or a preview with a branch (Task 3).
 */
export function MaterialRequirementsTable({
  lines, batchWeight, batchCount, plannedQty, unitAbbreviation,
}: {
  lines: MaterialRequirementDto[]
  batchWeight: string
  batchCount: number
  plannedQty: string
  /** The finished good's unit, for the column headings. */
  unitAbbreviation: string
}) {
  const showStock = lines.some(line => line.stock !== null)
  const th = 'px-4 py-3 text-right font-medium'

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-3 font-medium">Material</th>
            <th className={th}>Per batch of {trimDecimal(batchWeight)} {unitAbbreviation}</th>
            <th className={th}>
              {showStock ? 'Required' : 'Total'} for {batchCount} {batchCount === 1 ? 'batch' : 'batches'} ({trimDecimal(plannedQty)} {unitAbbreviation})
            </th>
            {showStock && (
              <>
                <th className={th}>On hand</th>
                <th className={th} title="Still needed by other approved or in-progress orders at this branch">Committed</th>
                <th className={th}>Available</th>
                <th className="px-4 py-3 font-medium">Stock</th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {lines.map(line => {
            const unit = <span className="font-normal text-gray-400">{line.unitAbbreviation}</span>
            return (
              <tr key={line.materialId}>
                <td className="px-4 py-3">
                  <p className="text-gray-700">{line.materialName}</p>
                  <p className="font-mono text-xs text-gray-400">{line.materialCode}</p>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                  {trimDecimal(line.perBatch)} {unit}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-800">
                  {trimDecimal(line.total)} {unit}
                </td>
                {line.stock && (
                  <>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-500">{trimDecimal(line.stock.onHand)} {unit}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-500">{trimDecimal(line.stock.committed)} {unit}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">{trimDecimal(line.stock.available)} {unit}</td>
                    <td className="px-4 py-3">
                      {line.stock.enough ? (
                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">Enough</span>
                      ) : (
                        <span className="whitespace-nowrap rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">
                          Short {trimDecimal(line.stock.short)} {line.unitAbbreviation}
                        </span>
                      )}
                    </td>
                  </>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
