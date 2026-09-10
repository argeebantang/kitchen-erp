import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Plus } from 'lucide-react'
import { getSession } from '@/lib/session'
import { PurchaseRequestService } from '@/services/purchase-request.service'
import { formatPeso } from '@/lib/format'
import { StatusBadge } from '@/components/procurement/StatusBadge'

export default async function PurchaseRequestListPage() {
  // Server Components never see the x-user-id header middleware injects — that
  // reaches route handlers only. They re-read the cookie via getSession()
  // instead (docs/architecture.md). The protected layout already redirects an
  // unauthenticated visitor; this call narrows the type.
  const session = await getSession()
  if (!session) redirect('/login')

  // Called directly rather than through an API route, because this is a read
  // (docs/architecture.md). Scoping to the viewer happens inside the service,
  // never at the call site.
  const { purchaseRequests, total } = await PurchaseRequestService.list(
    { userId: session.userId, role: session.role },
    { take: 100 },
  )

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Purchase Requests</h1>
          <p className="mt-1 text-sm text-gray-400">
            {total === 0
              ? 'Raise a request for materials. Accounting approves it before it becomes a purchase order.'
              : `${total} request${total === 1 ? '' : 's'}.`}
          </p>
        </div>

        <Link
          href="/procurement/requests/new"
          className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
        >
          <Plus size={16} />
          New Request
        </Link>
      </div>

      {purchaseRequests.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-gray-600">No purchase requests yet</p>
          <p className="mt-1 text-sm text-gray-400">Create one to get started.</p>
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
                  {/* ISO string sliced rather than toLocaleDateString(): locale
                      formatting differs between the server and browser renders,
                      which React reports as a hydration mismatch. */}
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
