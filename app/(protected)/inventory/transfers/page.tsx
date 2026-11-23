import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { formatDateTime } from '@/lib/dates'
import { formatPeso, formatQuantity } from '@/lib/format'
import { inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'
import { BranchRepository } from '@/repositories/branch.repository'
import { isTransferStatus, STOCK_TRANSFER_SORT_KEYS, StockTransferService, TRANSFER_STATUSES, transferStatusLabel } from '@/services/stock-transfer.service'
import { ReturnBadge } from '@/components/inventory/BranchTransfers'
import { StatusBadge } from '@/components/procurement/StatusBadge'
import { EmptyState } from '@/components/ui/states'
import { Store, SearchX, ArrowLeftRight } from 'lucide-react'
import { KeepListParams, ListEmptyState, Pagination, SortHeader } from '@/components/ui/ListControls'
import { SearchBox } from '@/components/ui/SearchBox'
import { parseListQuery } from '@/lib/list-query'

const PATH = '/inventory/transfers'

type PageProps = {
  searchParams: Promise<{ status?: string; branch?: string; short?: string; page?: string; q?: string; sort?: string; dir?: string }>
}

/**
 * Transfer Orders (Week 8 Task 2): finished goods sent from a commissary to
 * another branch, newest first. ADMIN, PRODUCTION_MANAGER and ACCOUNTING see
 * every transfer; a BRANCH_MANAGER only those to or from the branch they
 * manage (T4, filtered in the service). Transfers that arrived short carry a
 * "Short ₱X" badge, can be listed on their own, and are totalled (Task 4, V7).
 */
export default async function TransferListPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')

  // Unknown filter values are ignored rather than an error, so a stale link still opens.
  const { status: statusParam = '', branch: branchParam = '', short: shortParam } = await searchParams
  const status    = isTransferStatus(statusParam) ? statusParam : undefined
  const shortOnly = shortParam === '1'
  // Paging, search and sort live in the URL (lib/list-query.ts); the database does all three.
  const params = await searchParams
  const query  = parseListQuery(params, { sorts: STOCK_TRANSFER_SORT_KEYS, defaultSort: { key: 'recorded', dir: 'desc' } })
  const header = { sort: query.sort, path: PATH, params }
  const canRecord = session.role === 'ADMIN' || session.role === 'PRODUCTION_MANAGER'
  // Returns (Week 9 Task 9): an outlet's manager or an admin; the form says so if they run no outlet.
  const canReturn = session.role === 'ADMIN' || session.role === 'BRANCH_MANAGER'

  // Inactive branches included: their transfers are history worth finding.
  const branches = await BranchRepository.findAll(true)
  const branchId = branches.some(b => b.id === branchParam) ? branchParam : undefined

  const { transfers, total, lost, scopedTo, managesNoBranch } = await StockTransferService.list(
    { userId: session.userId, role: session.role },
    { status, branchId, shortOnly, skip: query.skip, take: query.take, search: query.q || undefined, listSort: query.sort },
  )
  // A branch manager sees one branch already, so the branch filter is not offered.
  const showBranchFilter = scopedTo === null && !managesNoBranch
  const filtered = status !== undefined || shortOnly || (showBranchFilter && branchId !== undefined)


  // The same filters, arrived short only.
  const shortHref = (() => {
    const query = new URLSearchParams({ short: '1' })
    if (status) query.set('status', status)
    if (branchId && showBranchFilter) query.set('branch', branchId)
    return `/inventory/transfers?${query.toString()}`
  })()

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Transfers</h1>
          <p className="mt-1 text-sm text-gray-400">
            Finished goods sent from a commissary to another branch, and returns of unsold goods from an outlet to a kitchen.
            {scopedTo && <> Showing transfers to and from <span className="font-medium text-gray-600">{scopedTo.name}</span>, the branch you manage.</>}
          </p>
        </div>
        <div className="flex gap-2">
          {canReturn && <Link href="/inventory/transfers/return" className={secondaryButtonClass}>Return to a kitchen</Link>}
          {canRecord && <Link href="/inventory/transfers/new" className={primaryButtonClass}>New transfer</Link>}
        </div>
      </div>

      {!managesNoBranch && (
        // A GET form: the filters live in the URL, so a filtered list can be linked to.
        <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
          <SearchBox placeholder="Search number, branch, good, request" />
          <KeepListParams params={params} />
          <label className="block min-w-48">
            <span className="mb-1 block text-xs font-medium text-gray-500">Status</span>
            <select name="status" defaultValue={status ?? ''} className={inputClass}>
              <option value="">All statuses</option>
              {TRANSFER_STATUSES.map(option => (
                <option key={option} value={option}>{option.replace(/_/g, ' ').toLowerCase()}</option>
              ))}
            </select>
          </label>
          {showBranchFilter && (
            <label className="block min-w-48">
              <span className="mb-1 block text-xs font-medium text-gray-500">Branch (from or to)</span>
              <select name="branch" defaultValue={branchId ?? ''} className={inputClass}>
                <option value="">All branches</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}{b.isActive ? '' : ' (inactive)'}</option>)}
              </select>
            </label>
          )}
          <label className="block min-w-48">
            <span className="mb-1 block text-xs font-medium text-gray-500">Arrival</span>
            <select name="short" defaultValue={shortOnly ? '1' : ''} className={inputClass}>
              <option value="">Any</option>
              <option value="1">Arrived short</option>
            </select>
          </label>
          <button type="submit" className={primaryButtonClass}>Apply</button>
          {filtered && <Link href="/inventory/transfers" className={secondaryButtonClass}>Clear</Link>}
        </form>
      )}

      {lost.count > 0 && (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span>
            Lost in transit{filtered ? ' (these filters)' : ''}: <span className="font-semibold tabular-nums">{formatPeso(lost.value)}</span> at cost,
            across {lost.count} transfer{lost.count === 1 ? '' : 's'} that arrived short
            {lost.unvalued > 0 && <> — {lost.unvalued} with a lot that has no cost, not counted in the total</>}.
          </span>
          {!shortOnly && <Link href={shortHref} className="text-xs font-medium text-amber-900 hover:underline">Show them</Link>}
        </div>
      )}

      {managesNoBranch ? (
        <EmptyState icon={Store} title="You don't manage a branch yet">
          An admin assigns branch managers in Master Data → Branches.
        </EmptyState>
      ) : transfers.length === 0 && (query.q || total > 0) ? (
        <ListEmptyState path={PATH} params={params} q={query.q} rowCount={transfers.length} total={total} noun="transfers" />
      ) : transfers.length === 0 ? (
        filtered ? (
          <EmptyState icon={SearchX} title="No transfers match these filters" action={{ href: '/inventory/transfers', label: 'Clear filters' }} />
        ) : (
          <EmptyState
            icon={ArrowLeftRight}
            title="No transfers yet"
            action={canRecord ? { href: '/inventory/transfers/new', label: 'New transfer' } : undefined}
          >
            {canRecord ? 'Send finished goods from a kitchen to a branch.' : 'The kitchen records what it sends to each branch here.'}
          </EmptyState>
        )
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <SortHeader label="Number" sortKey="number" firstDir="desc" {...header} />
                <SortHeader label="From → To" sortKey="from" {...header} />
                <th className="px-4 py-3 font-medium">Goods</th>
                <SortHeader label="Recorded" sortKey="recorded" firstDir="desc" {...header} />
                <SortHeader label="Status" sortKey="status" {...header} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {transfers.map(row => (
                <tr key={row.id} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/inventory/transfers/${row.id}`} className="font-mono text-xs text-orange-600 hover:text-orange-700 hover:underline">
                      {row.transferNumber}
                    </Link>
                    {row.kind === 'RETURN' && <ReturnBadge />}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {row.fromBranch.name} <span className="text-gray-400">→</span> {row.toBranch.name}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {row.lines.map(line => (
                      <span key={line.finishedGoodId} className="block">
                        {line.finishedGoodName}{' '}
                        <span className="text-gray-500">{formatQuantity(line.quantity)} {line.unitAbbreviation}</span>
                      </span>
                    ))}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {formatDateTime(row.createdAt)}
                    <span className="block text-xs text-gray-400">{row.submittedByName}</span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} label={transferStatusLabel(row)} />
                    {row.varianceReason && (
                      <span className="mt-1 block w-fit rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        Short{row.varianceValue !== null && <> {formatPeso(row.varianceValue)}</>}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination path={PATH} params={params} page={query.page} pageSize={query.take} total={total} noun="transfers" />
    </div>
  )
}
