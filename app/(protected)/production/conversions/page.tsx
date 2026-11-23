import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Plus, SearchX, Undo2 } from 'lucide-react'
import { getSession } from '@/lib/session'
import { formatDateTime } from '@/lib/dates'
import { formatQuantity } from '@/lib/format'
import { inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'
import { CONVERSION_STATUSES, CONVERSION_ORDER_SORT_KEYS, ConversionOrderService, isConversionStatus } from '@/services/conversion-order.service'
import { StatusBadge } from '@/components/procurement/StatusBadge'
import { EmptyState } from '@/components/ui/states'
import { KeepListParams, ListEmptyState, Pagination, SortHeader } from '@/components/ui/ListControls'
import { SearchBox } from '@/components/ui/SearchBox'
import { parseListQuery } from '@/lib/list-query'

const PATH = '/production/conversions'

type PageProps = {
  searchParams: Promise<{ status?: string; page?: string; q?: string; sort?: string; dir?: string }>
}

export default async function ConversionOrderListPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  // Accounting reads this list to decide; /production/conversions/new is production's.
  const canConvert = session.role === 'ADMIN' || session.role === 'PRODUCTION_MANAGER'

  // An unknown status is ignored rather than an error, so a stale link still opens.
  const { status: statusParam = '' } = await searchParams
  const status = isConversionStatus(statusParam) ? statusParam : undefined
  // Paging, search and sort live in the URL (lib/list-query.ts); the database does all three.
  const params = await searchParams
  const query  = parseListQuery(params, { sorts: CONVERSION_ORDER_SORT_KEYS, defaultSort: { key: 'recorded', dir: 'desc' } })
  const header = { sort: query.sort, path: PATH, params }

  const { conversionOrders, total } = await ConversionOrderService.list({
    status,
    skip: query.skip,
    take: query.take, search: query.q || undefined, listSort: query.sort,
  })


  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Conversions</h1>
          <p className="mt-1 text-sm text-gray-400">
            {total === 0 && !status
              ? 'Unsold finished goods made into another dish — e.g. Lechon into Lechon Paksiw.'
              : `${total} conversion${total === 1 ? '' : 's'}${status ? ` ${status.replace(/_/g, ' ').toLowerCase()}` : ''}.`}
          </p>
        </div>

        {canConvert && (
          <Link
            href="/production/conversions/new"
            className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
          >
            <Plus size={16} />
            Record Conversion
          </Link>
        )}
      </div>

      {/* A GET form: the filter lives in the URL, so a filtered list can be linked to. */}
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <SearchBox placeholder="Search number, good, branch, person" />
        <KeepListParams params={params} />
        <label className="block min-w-48">
          <span className="mb-1 block text-xs font-medium text-gray-500">Status</span>
          <select name="status" defaultValue={status ?? ''} className={inputClass}>
            <option value="">All statuses</option>
            {CONVERSION_STATUSES.map(option => (
              <option key={option} value={option}>{option.replace(/_/g, ' ').toLowerCase()}</option>
            ))}
          </select>
        </label>
        <button type="submit" className={primaryButtonClass}>Apply</button>
        {status && <Link href="/production/conversions" className={secondaryButtonClass}>Clear</Link>}
      </form>

      {conversionOrders.length === 0 && (query.q || total > 0) ? (
        <ListEmptyState path={PATH} params={params} q={query.q} rowCount={conversionOrders.length} total={total} noun="conversions" />
      ) : conversionOrders.length === 0 ? (
        status ? (
          <EmptyState icon={SearchX} title="No conversions with this status" action={{ href: '/production/conversions', label: 'Clear filter' }} />
        ) : (
          <EmptyState
            icon={Undo2}
            title="No conversions yet"
            action={canConvert ? { href: '/production/conversions/new', label: 'Record Conversion' } : undefined}
          >
            {canConvert ? 'Record one after the kitchen converts a finished good into another.' : 'Production records conversions here.'}
          </EmptyState>
        )
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <SortHeader label="Number" sortKey="number" firstDir="desc" {...header} />
                <SortHeader label="Made" sortKey="made" align="right" {...header} />
                <SortHeader label="From" sortKey="from" align="right" {...header} />
                <SortHeader label="Branch" sortKey="branch" {...header} />
                <SortHeader label="Recorded" sortKey="recorded" firstDir="desc" {...header} />
                <SortHeader label="By" sortKey="by" {...header} />
                <SortHeader label="Status" sortKey="status" {...header} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {conversionOrders.map(row => (
                <tr key={row.id} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/production/conversions/${row.id}`}
                      className="font-mono text-xs text-orange-600 hover:text-orange-700 hover:underline"
                    >
                      {row.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {formatQuantity(row.outputQty)} <span className="text-gray-400">{row.unitAbbreviation}</span> {row.finishedGoodName}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {formatQuantity(row.sourceQty)} <span className="text-gray-400">{row.sourceUnitAbbreviation}</span> {row.sourceName}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{row.branchName}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDateTime(row.createdAt)}</td>
                  <td className="px-4 py-3 text-gray-500">{row.submittedByName}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination path={PATH} params={params} page={query.page} pageSize={query.take} total={total} noun="conversions" />
    </div>
  )
}
