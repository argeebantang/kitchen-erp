import Link from 'next/link'
import { RECEIVING_REPORT_SORT_KEYS, ReceivingReportService } from '@/services/receiving-report.service'
import { StatusBadge } from '@/components/procurement/StatusBadge'
import { VarianceBadge } from '@/components/procurement/VarianceChips'
import { EmptyState } from '@/components/ui/states'
import { Truck } from 'lucide-react'
import { ListEmptyState, Pagination, SortHeader } from '@/components/ui/ListControls'
import { SearchBox } from '@/components/ui/SearchBox'
import { parseListQuery, type SearchParams } from '@/lib/list-query'

const PATH = '/procurement/receiving'

export default async function ReceivingReportListPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // No getSession(), like the purchase order list: reports are not scoped to a
  // viewer, so there is no identity to pass down.
  // Paging, search and sort live in the URL (lib/list-query.ts); the database does all three.
  const params = await searchParams
  const query  = parseListQuery(params, { sorts: RECEIVING_REPORT_SORT_KEYS, defaultSort: { key: 'number', dir: 'desc' } })
  const header = { sort: query.sort, path: PATH, params }
  const { receivingReports, total } = await ReceivingReportService.list({ skip: query.skip, take: query.take, search: query.q || undefined, listSort: query.sort })

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

      <div className="mb-4">
        <SearchBox placeholder="Search number, order, supplier, branch, material" />
      </div>

      {receivingReports.length === 0 && (query.q || total > 0) ? (
        <ListEmptyState path={PATH} params={params} q={query.q} rowCount={receivingReports.length} total={total} noun="reports" />
      ) : receivingReports.length === 0 ? (
        <EmptyState icon={Truck} title="No deliveries recorded yet" action={{ href: '/procurement/orders', label: 'Purchase Orders' }}>
          Open a sent order on Purchase Orders and click Receive delivery.
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <SortHeader label="Number" sortKey="number" firstDir="desc" {...header} />
                <SortHeader label="Order" sortKey="order" {...header} />
                <SortHeader label="Supplier" sortKey="supplier" {...header} />
                <SortHeader label="Branch" sortKey="branch" {...header} />
                <th className="px-4 py-3 font-medium">Lines</th>
                <th className="px-4 py-3 font-medium">Variance</th>
                <SortHeader label="Received" sortKey="received" firstDir="desc" {...header} />
                <SortHeader label="Received by" sortKey="receivedBy" {...header} />
                <SortHeader label="Status" sortKey="status" {...header} />
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
                  <td className="px-4 py-3">
                    <VarianceBadge varianceLineCount={row.varianceLineCount} />
                  </td>
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

      <Pagination path={PATH} params={params} page={query.page} pageSize={query.take} total={total} noun="reports" />
    </div>
  )
}
