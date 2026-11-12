import Link from 'next/link'
import { formatDateTime } from '@/lib/dates'
import { formatPeso, formatQuantity } from '@/lib/format'
// Type-only: rendered on the server, for the conversion page.
import type { ConversionStockDto, RecordedConversionCostDto } from '@/services/conversion-order.service'

/**
 * What an approved conversion moved (Week 7 Task 1, D6), read back from both
 * ledgers like a production order's Stock moved card: the output lot in, the
 * source lots it came from, and the added ingredients out — with the cost
 * approval recorded (D7).
 */
export function ConversionStock({ stock, cost, finishedGoodName, sourceName }: {
  stock: ConversionStockDto
  cost: RecordedConversionCostDto | null
  finishedGoodName: string
  sourceName: string
}) {
  const unit = stock.lot?.unitAbbreviation ?? ''

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Stock moved</p>

      {stock.lot && (
        <p className="mb-3 text-sm">
          <span className="font-medium text-emerald-700">+{formatQuantity(stock.lot.quantity)} {unit}</span>
          <span className="text-gray-700"> {finishedGoodName}</span>
          <span className="text-gray-400">
            {' '}· lot <span className="font-mono">{stock.lot.lotNumber}</span> · produced {stock.lot.producedOn}
            {stock.lot.expiresAt !== null && <> · expires {formatDateTime(stock.lot.expiresAt)}</>}
            {' '}→ {stock.lot.branchName}
          </span>
          {stock.lot.unitCost !== null && <span className="text-gray-500"> @ {formatPeso(stock.lot.unitCost)}/{unit}</span>}
        </p>
      )}

      <ul className="mb-3 space-y-1 text-sm">
        {stock.sourceLots.map(movement => (
          <li key={movement.id} className="flex flex-wrap items-center gap-2 px-0 py-1">
            <span className="font-medium text-red-700">{formatQuantity(movement.quantity).replace(/^-/, '−')} {movement.unitAbbreviation}</span>
            <span className="text-gray-700">{sourceName}</span>
            <span className="text-gray-400">from lot <span className="font-mono">{movement.lotNumber}</span></span>
            {movement.unitCost !== null && <span className="text-gray-500">@ {formatPeso(movement.unitCost)}/{movement.unitAbbreviation}</span>}
          </li>
        ))}
      </ul>

      <ul className="space-y-1 text-sm">
        {stock.ingredients.map(movement => (
          <li key={movement.id}>
            {/* The material's ledger at this branch, with its running balance. */}
            <Link
              href={`/inventory/ledger?material=${movement.materialId}&branch=${movement.branchId}`}
              className="-mx-2 flex flex-wrap items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-gray-50"
              title="Open this material's ledger at this branch"
            >
              <span className="font-medium text-red-700">
                {formatQuantity(movement.quantity).replace(/^-/, '−')} {movement.unitAbbreviation}
              </span>
              <span className="text-gray-700">{movement.materialName}</span>
              {movement.unitCost !== null && (
                <span className="text-gray-500">@ {formatPeso(movement.unitCost)}/{movement.unitAbbreviation}</span>
              )}
              <span className="font-mono text-xs text-gray-400">{movement.materialCode}</span>
              <span className="ml-auto text-xs text-orange-600">Ledger →</span>
            </Link>
          </li>
        ))}
      </ul>

      {cost && (
        <p className="mt-3 border-t border-gray-100 pt-3 text-sm text-gray-700">
          Cost recorded: <span className="font-medium">{formatPeso(cost.total)}</span>
          {stock.lot && <> for {formatQuantity(stock.lot.quantity)} {unit}</>} —{' '}
          <span className="font-medium">{formatPeso(cost.costPerUnit)}/{unit}</span>
          <span className="text-gray-500">
            {' '}= {sourceName} {formatPeso(cost.sourceCost)} + added ingredients {formatPeso(cost.conversionCost)}
          </span>
        </p>
      )}
    </div>
  )
}
