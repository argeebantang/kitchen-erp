import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { formatDateTime, shortDateLabel } from '@/lib/dates'
import { formatQuantity } from '@/lib/format'
import { inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'
import { BranchRepository } from '@/repositories/branch.repository'
import {
  isStockRequestStatus,
  STOCK_REQUEST_SORT_KEYS,
  StockRequestService,
  STOCK_REQUEST_STATUSES,
  type DemandDayDto,
} from '@/services/stock-request.service'
import { StatusBadge } from '@/components/procurement/StatusBadge'
import { LateBadge } from '@/components/inventory/LateBadge'
import { EmptyState } from '@/components/ui/states'
import { Store, SearchX, ClipboardList } from 'lucide-react'
import { KeepListParams, ListEmptyState, Pagination, SortHeader } from '@/components/ui/ListControls'
import { SearchBox } from '@/components/ui/SearchBox'
import { parseListQuery } from '@/lib/list-query'

const PATH = '/inventory/requests'

type PageProps = {
  searchParams: Promise<{ status?: string; kitchen?: string; page?: string; q?: string; sort?: string; dir?: string }>
}

/**
 * Stock requests (Week 9 Task 10). The kitchen (production, admins) sees the
 * demand board — open requests needed today or later, per kitchen and day,
 * totalled per finished good with the batches that cover it — and every
 * request below. A branch manager sees only their own outlet's requests.
 */
export default async function StockRequestListPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  const viewer = { userId: session.userId, role: session.role }

  const { status: statusParam = '', kitchen: kitchenParam = '' } = await searchParams
  const status = isStockRequestStatus(statusParam) ? statusParam : undefined
  const kitchens = await BranchRepository.findActiveKitchens()
  const kitchenId = kitchens.some(k => k.id === kitchenParam) ? kitchenParam : undefined

  // Paging, search and sort live in the URL (lib/list-query.ts); the database does all three.
  // The default is the kitchen's order of work: needed soonest first.
  const params = await searchParams
  const query  = parseListQuery(params, { sorts: STOCK_REQUEST_SORT_KEYS, defaultSort: { key: 'needed', dir: 'asc' } })
  const header = { sort: query.sort, path: PATH, params }

  const [{ requests, total, scopedTo, managesNoBranch }, demand] = await Promise.all([
    StockRequestService.list(viewer, { status, kitchenId, skip: query.skip, take: query.take, search: query.q || undefined, listSort: query.sort }),
    StockRequestService.demand(viewer, kitchenId),
  ])
  const isKitchen = session.role === 'ADMIN' || session.role === 'PRODUCTION_MANAGER'
  const canRequest = session.role === 'ADMIN' || (session.role === 'BRANCH_MANAGER' && scopedTo !== null)
  const filtered = status !== undefined || kitchenId !== undefined

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Stock requests</h1>
          <p className="mt-1 text-sm text-gray-400">
            Outlets ask a kitchen for finished goods by a day; the kitchen plans, cooks and sends them.
            {scopedTo && <> Showing <span className="font-medium text-gray-600">{scopedTo.name}</span>&apos;s requests, the outlet you manage.</>}
          </p>
        </div>
        {canRequest && <Link href="/inventory/requests/new" className={primaryButtonClass}>New request</Link>}
      </div>

      {isKitchen && <DemandBoard days={demand} />}

      {!managesNoBranch && (
        <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
          <SearchBox placeholder="Search number, outlet, kitchen, good" />
          <KeepListParams params={params} />
          <label className="block min-w-48">
            <span className="mb-1 block text-xs font-medium text-gray-500">Status</span>
            <select name="status" defaultValue={status ?? ''} className={inputClass}>
              <option value="">All statuses</option>
              {STOCK_REQUEST_STATUSES.map(option => (
                <option key={option} value={option}>{option.replace(/_/g, ' ').toLowerCase()}</option>
              ))}
            </select>
          </label>
          <label className="block min-w-48">
            <span className="mb-1 block text-xs font-medium text-gray-500">Kitchen</span>
            <select name="kitchen" defaultValue={kitchenId ?? ''} className={inputClass}>
              <option value="">All kitchens</option>
              {kitchens.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </label>
          <button type="submit" className={primaryButtonClass}>Apply</button>
          {filtered && <Link href="/inventory/requests" className={secondaryButtonClass}>Clear</Link>}
        </form>
      )}

      {managesNoBranch ? (
        <EmptyState icon={Store} title="You don't manage an outlet yet">
          An admin assigns branch managers in Master Data → Branches.
        </EmptyState>
      ) : requests.length === 0 && (query.q || total > 0) ? (
        <ListEmptyState path={PATH} params={params} q={query.q} rowCount={requests.length} total={total} noun="requests" />
      ) : requests.length === 0 ? (
        filtered ? (
          <EmptyState icon={SearchX} title="No requests match these filters" action={{ href: '/inventory/requests', label: 'Clear filters' }} />
        ) : (
          <EmptyState
            icon={ClipboardList}
            title="No stock requests yet"
            action={canRequest ? { href: '/inventory/requests/new', label: 'New request' } : undefined}
          >
            {canRequest ? 'Ask a kitchen for the finished goods your outlet needs.' : 'Outlets ask a kitchen for what they need here.'}
          </EmptyState>
        )
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <SortHeader label="Number" sortKey="number" firstDir="desc" {...header} />
                <SortHeader label="Needed" sortKey="needed" {...header} />
                <SortHeader label="Outlet → Kitchen" sortKey="outlet" {...header} />
                <th className="px-4 py-3 font-medium">Goods asked</th>
                <SortHeader label="Submitted" sortKey="submitted" firstDir="desc" {...header} />
                <SortHeader label="Status" sortKey="status" {...header} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {requests.map(row => (
                <tr key={row.id} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/inventory/requests/${row.id}`} className="font-mono text-xs text-orange-600 hover:text-orange-700 hover:underline">
                      {row.requestNumber}
                    </Link>
                    {row.late && <LateBadge />}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-700">{shortDateLabel(row.neededOn)}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {row.branch.name} <span className="text-gray-400">→</span> {row.kitchen.name}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {row.lines.map(line => (
                      <span key={line.itemId} className="block">
                        {line.finishedGoodName} <span className="text-gray-500">{formatQuantity(line.quantity)} {line.unitAbbreviation}</span>
                      </span>
                    ))}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {formatDateTime(row.createdAt)}
                    <span className="block text-xs text-gray-400">{row.submittedByName}</span>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!managesNoBranch && <Pagination path={PATH} params={params} page={query.page} pageSize={query.take} total={total} noun="requests" />}
    </div>
  )
}

/**
 * The kitchen's demand (S-5): per day and kitchen, each good totalled across
 * the outlets, with the batches that cover it and a way to plan the run.
 */
function DemandBoard({ days }: { days: DemandDayDto[] }) {
  return (
    <section className="mb-8">
      <h2 className="mb-1 text-lg font-semibold text-gray-800">Demand</h2>
      <p className="mb-3 text-sm text-gray-400">
        Open requests needed today or later, totalled per finished good — planned quantities once a request is planned, what was
        asked while it is not yet answered.
      </p>
      {days.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-200 bg-white p-6 text-center text-sm text-gray-400">No open requests.</p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {days.map(day => (
            <div key={`${day.neededOn}-${day.kitchen.id}`} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="border-b border-gray-100 bg-gray-50 px-4 py-3">
                <p className="text-sm font-semibold text-gray-800">{shortDateLabel(day.neededOn)} · {day.kitchen.name}</p>
              </div>
              <ul className="divide-y divide-gray-100">
                {day.lines.map(line => {
                  const planHref = `/production/orders/new?${new URLSearchParams({
                    good: line.finishedGoodId, branch: day.kitchen.id, date: day.neededOn, ...(line.batches ? { batches: String(line.batches) } : {}),
                  }).toString()}`
                  return (
                    <li key={line.finishedGoodId} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="text-gray-800">
                          <span className="font-medium">{line.finishedGoodName}</span>{' '}
                          <span className="tabular-nums">{formatQuantity(line.total)} {line.unitAbbreviation}</span>
                          {Number(line.unanswered) > 0 && (
                            <span className="ml-1.5 text-xs text-amber-700">({formatQuantity(line.unanswered)} not yet answered)</span>
                          )}
                        </p>
                        <p className="text-xs text-gray-500">
                          {line.outlets.map((outlet, index) => (
                            <span key={outlet.requestId}>
                              {index > 0 && ' · '}
                              <Link href={`/inventory/requests/${outlet.requestId}`} className="hover:underline">
                                {outlet.branchName} {formatQuantity(outlet.quantity)}
                              </Link>
                              {outlet.late && <span className="text-red-600"> (late)</span>}
                            </span>
                          ))}
                        </p>
                      </div>
                      {line.batches !== null ? (
                        <Link href={planHref} className="rounded-lg border border-orange-200 bg-white px-3 py-1.5 text-xs font-medium text-orange-700 transition-colors hover:bg-orange-50">
                          Plan production · {line.batches} × {formatQuantity(line.batchSize ?? '0')} {line.unitAbbreviation}
                        </Link>
                      ) : (
                        <span className="text-xs text-gray-400">No production recipe</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
