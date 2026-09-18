import Link from 'next/link'
import { PurchaseOrderService } from '@/services/purchase-order.service'
import { StatusBadge } from '@/components/procurement/StatusBadge'
import { formatPeso } from '@/lib/format'

export default async function PurchaseOrderListPage() {
  // No getSession() here, unlike the requests list. A purchase order is not
  // scoped to a viewer — every role middleware lets onto this URL needs the
  // whole list, so there is no identity to pass down.
  const { purchaseOrders, total } = await PurchaseOrderService.list({ take: 100 })

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

      {purchaseOrders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-gray-600">No purchase orders yet</p>
          <p className="mt-1 text-sm text-gray-400">
            Approve a purchase request and its order is created automatically.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Supplier</th>
                <th className="px-4 py-3 font-medium">From</th>
                <th className="px-4 py-3 font-medium">Lines</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Expected</th>
                <th className="px-4 py-3 font-medium">Status</th>
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
    </div>
  )
}
