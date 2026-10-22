import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { PurchaseRequestService } from '@/services/purchase-request.service'
import { PurchaseOrderService } from '@/services/purchase-order.service'
import { StatusBadge } from '@/components/procurement/StatusBadge'
import { formatPeso } from '@/lib/format'

export default async function ApprovalsInboxPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const [requests, orders] = await Promise.all([
    PurchaseRequestService.list(
      { userId: session.userId, role: session.role },
      { status: 'PENDING_APPROVAL', sort: 'neededBy', take: 100 },
    ),
    PurchaseOrderService.list({ status: 'PENDING_APPROVAL', take: 100 }),
  ])

  const { purchaseRequests, total: requestTotal } = requests
  const { purchaseOrders,   total: orderTotal }   = orders

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Approvals</h1>
        <p className="mt-1 text-sm text-gray-400">
            {requestTotal + orderTotal === 0
            ? 'Nothing is waiting for approval.'
            : `${requestTotal} purchase request${requestTotal === 1 ? '' : 's'} and ${orderTotal} purchase order${orderTotal === 1 ? '' : 's'} waiting for a decision. Open one to review its lines before deciding.`}
        </p>
      </div>
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Purchase requests</h2>
      {purchaseRequests.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-gray-600">Inbox clear</p>
          <p className="mt-1 text-sm text-gray-400">Submitted requests will appear here.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Requested by</th>
                <th className="px-4 py-3 font-medium">Lines</th>
                <th className="px-4 py-3 font-medium">Est. total</th>
                <th className="px-4 py-3 font-medium">Needed by</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {purchaseRequests.map(row => (
                <tr key={row.id} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/procurement/requests/${row.id}`}
                      className="font-mono text-xs text-orange-600 hover:text-orange-700 hover:underline"
                    >
                      {row.prNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{row.requesterName}</td>
                  <td className="px-4 py-3 text-gray-500">{row.lineCount}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {row.estimatedTotal === null
                      ? <span className="text-gray-400">Not priced</span>
                      : formatPeso(row.estimatedTotal)}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{row.neededBy?.slice(0, 10) ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mb-3 mt-8 text-sm font-semibold text-gray-700">Purchase orders</h2>

      {purchaseOrders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-gray-600">No purchase orders waiting</p>
          <p className="mt-1 text-sm text-gray-400">Orders procurement submits will appear here.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Supplier</th>
                <th className="px-4 py-3 font-medium">From request</th>
                <th className="px-4 py-3 font-medium">Lines</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Expected delivery</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {purchaseOrders.map(po => (
                <tr key={po.id} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/procurement/orders/${po.id}`}
                      className="font-mono text-xs text-orange-600 hover:text-orange-700 hover:underline"
                    >
                      {po.poNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{po.supplierName ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{po.prNumber ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{po.lineCount}</td>
                  <td className="px-4 py-3 text-gray-700">{formatPeso(po.totalAmount)}</td>
                  <td className="px-4 py-3 text-gray-500">{po.expectedDelivery?.slice(0, 10) ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={po.status} />
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