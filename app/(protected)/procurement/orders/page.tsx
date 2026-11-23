import Link from 'next/link'
import { PURCHASE_ORDER_SORT_KEYS, PurchaseOrderService } from '@/services/purchase-order.service'
import { StatusBadge } from '@/components/procurement/StatusBadge'
import { formatPeso } from '@/lib/format'
import { EmptyState } from '@/components/ui/states'
import { ShoppingCart } from 'lucide-react'
import { ListEmptyState, Pagination, SortHeader } from '@/components/ui/ListControls'
import { SearchBox } from '@/components/ui/SearchBox'
import { parseListQuery, type SearchParams } from '@/lib/list-query'

const PATH = '/procurement/orders'

export default async function PurchaseOrderListPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // No getSession() here, unlike the requests list. A purchase order is not
  // scoped to a viewer — every role middleware lets onto this URL needs the
  // whole list, so there is no identity to pass down.
  // Paging, search and sort live in the URL (lib/list-query.ts); the database does all three.
  const params = await searchParams
  const query  = parseListQuery(params, { sorts: PURCHASE_ORDER_SORT_KEYS, defaultSort: { key: 'number', dir: 'desc' } })
  const header = { sort: query.sort, path: PATH, params }
  const { purchaseOrders, total } = await PurchaseOrderService.list({ skip: query.skip, take: query.take, search: query.q || undefined, listSort: query.sort })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Purchase Orders</h1>
        <p className="mt-1 text-sm text-gray-400">
          {total === 0
            ? 'Orders appear here when accounting approves a purchase request.'
            : `${total} order${total === 1 ? '' : 's'}. A draft needs a supplier before it can go for approval.`}
        </p>
      </div>

      <div className="mb-4">
        <SearchBox placeholder="Search number, supplier, request, material" />
      </div>

      {purchaseOrders.length === 0 && (query.q || total > 0) ? (
        <ListEmptyState path={PATH} params={params} q={query.q} rowCount={purchaseOrders.length} total={total} noun="orders" />
      ) : purchaseOrders.length === 0 ? (
        <EmptyState icon={ShoppingCart} title="No purchase orders yet">
          Approve a purchase request and its order is created automatically.
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <SortHeader label="Number" sortKey="number" firstDir="desc" {...header} />
                <SortHeader label="Supplier" sortKey="supplier" {...header} />
                <th className="px-4 py-3 font-medium">From</th>
                <th className="px-4 py-3 font-medium">Lines</th>
                <SortHeader label="Total" sortKey="total" firstDir="desc" {...header} />
                <SortHeader label="Expected" sortKey="expected" {...header} />
                <SortHeader label="Status" sortKey="status" {...header} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {purchaseOrders.map(row => (
                <tr key={row.id} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/procurement/orders/${row.id}`}
                      className="font-mono text-xs text-orange-600 hover:text-orange-700 hover:underline"
                    >
                      {row.poNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {row.supplierName ?? (
                      <span className="text-amber-600">Not chosen yet</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">
                    {row.prNumber ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{row.lineCount}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {formatPeso(row.totalAmount)}
                    {row.supplierName === null && (
                      <span className="ml-1 text-xs text-gray-400">est.</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {row.expectedDelivery?.slice(0, 10) ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination path={PATH} params={params} page={query.page} pageSize={query.take} total={total} noun="orders" />
    </div>
  )
}
