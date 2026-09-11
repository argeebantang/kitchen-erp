import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { PurchaseRequestService } from '@/services/purchase-request.service'
import { StatusBadge } from '@/components/procurement/StatusBadge'
import { formatPeso } from '@/lib/format'

export default async function ApprovalsInboxPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  // middleware.ts already restricts this URL to ADMIN and ACCOUNTING — both
  // see-all roles — so this lists every pending request, whoever raised it.
  // No new service code: list() already accepted a status filter.
  const { purchaseRequests, total } = await PurchaseRequestService.list(
    { userId: session.userId, role: session.role },
    { status: 'PENDING_APPROVAL', take: 100 },
  )

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Approvals</h1>
        <p className="mt-1 text-sm text-gray-400">
          {total === 0
            ? 'Nothing is waiting for approval.'
            : `${total} purchase request${total === 1 ? '' : 's'} waiting for a decision. Open one to review its lines before approving.`}
        </p>
      </div>

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
    </div>
  )
}