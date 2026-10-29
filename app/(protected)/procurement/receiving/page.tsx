import Link from 'next/link'
import { ReceivingReportService } from '@/services/receiving-report.service'
import { StatusBadge } from '@/components/procurement/StatusBadge'

export default async function ReceivingReportListPage() {
  // No getSession(), like the purchase order list: reports are not scoped to a
  // viewer, so there is no identity to pass down.
  const { receivingReports, total } = await ReceivingReportService.list({ take: 100 })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Receiving</h1>
        <p className="mt-1 text-sm text-gray-400">
          {total === 0
            ? 'Record a delivery from a sent purchase order with Receive delivery.'
            : `${total} report${total === 1 ? '' : 's'}.`}{' '}
          Stock is updated only once accounting approves a report.
        </p>
      </div>

      {receivingReports.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-gray-600">No deliveries recorded yet</p>
          <p className="mt-1 text-sm text-gray-400">
            Open a sent order on{' '}
            <Link href="/procurement/orders" className="text-orange-600 hover:underline">Purchase Orders</Link>
            {' '}and click Receive delivery.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">Supplier</th>
                <th className="px-4 py-3 font-medium">Branch</th>
                <th className="px-4 py-3 font-medium">Lines</th>
                <th className="px-4 py-3 font-medium">Received</th>
                <th className="px-4 py-3 font-medium">Received by</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {receivingReports.map(row => (
                <tr key={row.id} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/procurement/receiving/${row.id}`}
                      className="font-mono text-xs text-orange-600 hover:text-orange-700 hover:underline"
                    >
                      {row.rrNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/procurement/orders/${row.purchaseOrderId}`}
                      className="font-mono text-xs text-gray-500 hover:text-gray-700 hover:underline"
                    >
                      {row.poNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{row.supplierName ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{row.branchName}</td>
                  <td className="px-4 py-3 text-gray-500">{row.lineCount}</td>
                  <td className="px-4 py-3 text-gray-500">{row.receivedAt.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-gray-500">{row.receivedByName}</td>
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
