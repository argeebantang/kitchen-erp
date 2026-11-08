import { trimDecimal } from '@/lib/format'
// Type-only: this renders on the detail page (server) and inside
// ProductionOrderForm (client), so it must not pull the service in.
import type { MaterialRequirementDto } from '@/services/production-order.service'

/**
 * No 'use client' and no state, so it renders on the server for the detail
 * page and joins the client bundle only through the form that imports it.
 * Every figure arrives computed (Decimal, server-side); this only trims zeros.
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
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-3 font-medium">Material</th>
            <th className="px-4 py-3 text-right font-medium">
              Per batch of {trimDecimal(batchWeight)} {unitAbbreviation}
            </th>
            <th className="px-4 py-3 text-right font-medium">
              Total for {batchCount} {batchCount === 1 ? 'batch' : 'batches'} ({trimDecimal(plannedQty)} {unitAbbreviation})
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {lines.map(line => (
            <tr key={line.materialId}>
              <td className="px-4 py-3">
                <p className="text-gray-700">{line.materialName}</p>
                <p className="font-mono text-xs text-gray-400">{line.materialCode}</p>
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                {trimDecimal(line.perBatch)} <span className="text-gray-400">{line.unitAbbreviation}</span>
              </td>
              <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-800">
                {trimDecimal(line.total)} <span className="font-normal text-gray-400">{line.unitAbbreviation}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
