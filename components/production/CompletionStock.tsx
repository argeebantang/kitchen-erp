import Link from 'next/link'
import { trimDecimal } from '@/lib/format'
// Type-only: rendered on the server, for the order page.
import type { CompletionStockDto } from '@/services/production-order.service'

/**
 * What an approved completion moved (Week 6 Task 2, D8): the ingredients that
 * came off and the lot that went on — read back from both ledgers, like the
 * receiving report's Stock card, so it shows the books as they are.
 */
export function CompletionStock({ stock, finishedGoodName }: { stock: CompletionStockDto; finishedGoodName: string }) {
  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Stock moved</p>

      {stock.lot && (
        <p className="mb-3 text-sm">
          <span className="font-medium text-emerald-700">
            +{trimDecimal(stock.lot.quantity)} {stock.lot.unitAbbreviation}
          </span>
          <span className="text-gray-700"> {finishedGoodName}</span>
          <span className="text-gray-400">
            {' '}· lot <span className="font-mono">{stock.lot.lotNumber}</span> · produced {stock.lot.producedOn} → {stock.lot.branchName}
          </span>
        </p>
      )}

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
                {trimDecimal(movement.quantity).replace(/^-/, '−')} {movement.unitAbbreviation}
              </span>
              <span className="text-gray-700">{movement.materialName}</span>
              <span className="font-mono text-xs text-gray-400">{movement.materialCode}</span>
              <span className="ml-auto text-xs text-orange-600">Ledger →</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
