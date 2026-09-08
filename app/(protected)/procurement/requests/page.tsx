import Link from 'next/link'
import { Plus } from 'lucide-react'
import { formatPeso } from '@/lib/format'

// TEMPORARY: hardcoded so the page is viewable before any data layer is wired.
// Replaced with a real PurchaseRequestService.list() call in a later step.
const DUMMY_ROWS = [
  { id: 'a', prNumber: 'PR-000001', requesterName: 'Pedro Branch',     lineCount: 2, estimatedTotal: '10100', neededBy: '2026-09-10', status: 'DRAFT' },
  { id: 'b', prNumber: 'PR-000002', requesterName: 'Maria Production', lineCount: 5, estimatedTotal: '24350', neededBy: '2026-09-12', status: 'PENDING_APPROVAL' },
  { id: 'c', prNumber: 'PR-000003', requesterName: 'Pedro Branch',     lineCount: 1, estimatedTotal: null,    neededBy: null,         status: 'APPROVED' },
]

const STATUS_STYLES: Record<string, string> = {
  DRAFT:            'bg-gray-100 text-gray-600',
  PENDING_APPROVAL: 'bg-amber-50 text-amber-700',
  APPROVED:         'bg-emerald-50 text-emerald-700',
  REJECTED:         'bg-red-50 text-red-700',
  CONVERTED_TO_PO:  'bg-blue-50 text-blue-700',
}

export default function PurchaseRequestListPage() {
  const rows = DUMMY_ROWS

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Purchase Requests</h1>
          <p className="mt-1 text-sm text-gray-400">
            Raise a request for materials. Accounting approves it before it becomes a purchase order.
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

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-gray-600">No purchase requests yet</p>
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
              {rows.map(row => (
                <tr key={row.id} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{row.prNumber}</td>
                  <td className="px-4 py-3 text-gray-700">{row.requesterName}</td>
                  <td className="px-4 py-3 text-gray-500">{row.lineCount}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {row.estimatedTotal === null
                      ? <span className="text-gray-400">Not priced</span>
                      : formatPeso(row.estimatedTotal)}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{row.neededBy ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status]}`}>
                      {row.status.replace(/_/g, ' ')}
                    </span>
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