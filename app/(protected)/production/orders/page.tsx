import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CalendarDays, ClipboardList, Plus, SearchX } from 'lucide-react'
import { getSession } from '@/lib/session'
import { trimDecimal } from '@/lib/format'
import { inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'
import { isProductionStatus, PRODUCTION_STATUSES, PRODUCTION_ORDER_SORT_KEYS, ProductionOrderService } from '@/services/production-order.service'
import { StatusBadge } from '@/components/procurement/StatusBadge'
import { EmptyState } from '@/components/ui/states'
import { KeepListParams, ListEmptyState, Pagination, SortHeader } from '@/components/ui/ListControls'
import { SearchBox } from '@/components/ui/SearchBox'
import { parseListQuery } from '@/lib/list-query'

const PATH = '/production/orders'

type PageProps = {
  searchParams: Promise<{ status?: string; page?: string; q?: string; sort?: string; dir?: string }>
}

export default async function ProductionOrderListPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  // Accounting reads this list (Task 5) but /production/orders/new is
  // production's; the button would only lead to /unauthorized.
  const canPlan = session.role === 'ADMIN' || session.role === 'PRODUCTION_MANAGER'

  // Filters arrive as plain query strings from the GET form below. An unknown
  // status is ignored rather than an error, so a stale link still opens.
  const { status: statusParam = '' } = await searchParams
  const status = isProductionStatus(statusParam) ? statusParam : undefined
  // Paging, search and sort live in the URL (lib/list-query.ts); the database does all three.
  const params = await searchParams
  const query  = parseListQuery(params, { sorts: PRODUCTION_ORDER_SORT_KEYS, defaultSort: { key: 'number', dir: 'desc' } })
  const header = { sort: query.sort, path: PATH, params }

  const { productionOrders, total } = await ProductionOrderService.list({
    status,
    skip: query.skip,
    take: query.take, search: query.q || undefined, listSort: query.sort,
  })


  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Production Orders</h1>
          <p className="mt-1 text-sm text-gray-400">
            {total === 0 && !status
              ? 'Plan a run of a finished good from its active BOM.'
              : `${total} order${total === 1 ? '' : 's'}${status ? ` ${status.replace(/_/g, ' ').toLowerCase()}` : ''}.`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/production/schedule" className={`inline-flex items-center gap-1.5 ${secondaryButtonClass}`}>
            <CalendarDays size={15} />
            Calendar
          </Link>
          {canPlan && (
            <Link
              href="/production/orders/new"
              className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
            >
              <Plus size={16} />
              New Production Order
            </Link>
          )}
        </div>
      </div>

      {/* A GET form: the filter lives in the URL, so a filtered list can be linked to. */}
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <SearchBox placeholder="Search number, good, branch, person" />
        <KeepListParams params={params} />
        <label className="block min-w-48">
          <span className="mb-1 block text-xs font-medium text-gray-500">Status</span>
          <select name="status" defaultValue={status ?? ''} className={inputClass}>
            <option value="">All statuses</option>
            {PRODUCTION_STATUSES.map(option => (
              <option key={option} value={option}>{option.replace(/_/g, ' ').toLowerCase()}</option>
            ))}
          </select>
        </label>
        <button type="submit" className={primaryButtonClass}>Apply</button>
        {status && <Link href="/production/orders" className={secondaryButtonClass}>Clear</Link>}
      </form>

      {/* Empty because of the filter, or empty for real — they need different next steps. */}
      {productionOrders.length === 0 && (query.q || total > 0) ? (
        <ListEmptyState path={PATH} params={params} q={query.q} rowCount={productionOrders.length} total={total} noun="orders" />
      ) : productionOrders.length === 0 && status ? (
        <EmptyState icon={SearchX} title="No production orders with this status" action={{ href: '/production/orders', label: 'Clear filter' }}>
          Nothing is {status.replace(/_/g, ' ').toLowerCase()} right now.
        </EmptyState>
      ) : productionOrders.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No production orders yet"
          action={canPlan ? { href: '/production/orders/new', label: 'New Production Order' } : undefined}
        >
          {canPlan ? 'Plan a run of a finished good from its active BOM.' : 'Production plans orders here; they show up once planned.'}
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <SortHeader label="Number" sortKey="number" firstDir="desc" {...header} />
                <SortHeader label="Finished good" sortKey="good" {...header} />
                <th className="px-4 py-3 font-medium">BOM</th>
                <SortHeader label="Planned" sortKey="planned" firstDir="desc" align="right" {...header} />
                <SortHeader label="Production date" sortKey="date" firstDir="desc" {...header} />
                <SortHeader label="Branch" sortKey="branch" {...header} />
                <SortHeader label="Requested by" sortKey="requester" {...header} />
                <SortHeader label="Status" sortKey="status" {...header} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {productionOrders.map(row => (
                <tr key={row.id} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/production/orders/${row.id}`}
                      className="font-mono text-xs text-orange-600 hover:text-orange-700 hover:underline"
                    >
                      {row.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-gray-700">{row.finishedGoodName}</p>
                    <p className="font-mono text-xs text-gray-400">{row.finishedGoodCode}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-500">v{row.bomVersion}</td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {trimDecimal(row.plannedQty)} <span className="text-gray-400">{row.unitAbbreviation}</span>
                    <p className="text-xs text-gray-400">
                      {row.batchCount} × {trimDecimal(row.batchWeight)} {row.unitAbbreviation}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{row.plannedDate}</td>
                  <td className="px-4 py-3 text-gray-500">{row.branchName}</td>
                  <td className="px-4 py-3 text-gray-500">{row.requestedByName}</td>
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
