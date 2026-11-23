import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { BranchRepository } from '@/repositories/branch.repository'
import { formatDateTime } from '@/lib/dates'
import { formatPeso, formatQuantity } from '@/lib/format'
import { inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'
import {
  isWriteOffReason,
  isWriteOffStatus,
  WRITE_OFF_REASONS,
  WRITE_OFF_SORT_KEYS,
  WRITE_OFF_STATUSES,
  WriteOffService,
} from '@/services/write-off.service'
import { StatusBadge } from '@/components/procurement/StatusBadge'
import { WriteOffReasonBadge } from '@/components/inventory/WriteOffReasonBadge'
import { EmptyState } from '@/components/ui/states'
import { SearchX, Trash2 } from 'lucide-react'
import { KeepListParams, ListEmptyState, Pagination, SortHeader } from '@/components/ui/ListControls'
import { SearchBox } from '@/components/ui/SearchBox'
import { parseListQuery } from '@/lib/list-query'

const PATH = '/inventory/write-offs'

type PageProps = {
  searchParams: Promise<{ status?: string; reason?: string; branch?: string; page?: string; q?: string; sort?: string; dir?: string }>
}

/**
 * Write-offs (Week 7 Task 2, W8), newest first, with the peso value lost —
 * "write-offs logged with peso value impact". ADMIN, PRODUCTION_MANAGER and
 * ACCOUNTING (middleware). Recording starts from a lot on Finished Goods.
 */
export default async function WriteOffListPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  const canWriteOff = session.role === 'ADMIN' || session.role === 'PRODUCTION_MANAGER'

  // Unknown filter values are ignored rather than an error, so a stale link still opens.
  const { status: statusParam = '', reason: reasonParam = '', branch: branchParam = '' } = await searchParams
  const status = isWriteOffStatus(statusParam) ? statusParam : undefined
  const reason = isWriteOffReason(reasonParam) ? reasonParam : undefined
  // Paging, search and sort live in the URL (lib/list-query.ts); the database does all three.
  const params = await searchParams
  const query  = parseListQuery(params, { sorts: WRITE_OFF_SORT_KEYS, defaultSort: { key: 'recorded', dir: 'desc' } })
  const header = { sort: query.sort, path: PATH, params }
  // Week 10 Task 2 follow-up: by branch too. An unknown branch matches nothing, like the schedule's.
  const branches = await BranchRepository.findAllActiveWithType()
  const branchId = branchParam || undefined

  const { writeOffs, total, approvedValue } = await WriteOffService.list({
    status, reason, branchId, skip: query.skip, take: query.take, search: query.q || undefined, listSort: query.sort,
  })
  const filtered  = status !== undefined || reason !== undefined || branchId !== undefined


  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Write-offs</h1>
          <p className="mt-1 text-sm text-gray-400">
            Finished goods taken out of stock because they could not be used or converted, at what they cost.
          </p>
        </div>
        {canWriteOff && (
          <Link href="/inventory/finished-goods" className={secondaryButtonClass}>
            Write off from Finished Goods →
          </Link>
        )}
      </div>

      {/* W8: the peso value impact — approved write-offs only, among everything the filters match. */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Written off{filtered ? ' (filtered)' : ''}</p>
          <p className="mt-1 text-2xl font-bold text-red-700">{formatPeso(approvedValue)}</p>
          <p className="text-xs text-gray-400">Approved write-offs, at each lot&apos;s cost</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Write-offs{filtered ? ' (filtered)' : ''}</p>
          <p className="mt-1 text-2xl font-bold text-gray-800">{total}</p>
          <p className="text-xs text-gray-400">Every status</p>
        </div>
      </div>

      {/* A GET form: the filters live in the URL, so a filtered list can be linked to. */}
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <SearchBox placeholder="Search number, lot, good, branch" />
        <KeepListParams params={params} />
        <label className="block min-w-48">
          <span className="mb-1 block text-xs font-medium text-gray-500">Status</span>
          <select name="status" defaultValue={status ?? ''} className={inputClass}>
            <option value="">All statuses</option>
            {WRITE_OFF_STATUSES.map(option => (
              <option key={option} value={option}>{option.replace(/_/g, ' ').toLowerCase()}</option>
            ))}
          </select>
        </label>
        <label className="block min-w-48">
          <span className="mb-1 block text-xs font-medium text-gray-500">Reason</span>
          <select name="reason" defaultValue={reason ?? ''} className={inputClass}>
            <option value="">All reasons</option>
            {WRITE_OFF_REASONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="block min-w-48">
          <span className="mb-1 block text-xs font-medium text-gray-500">Branch</span>
          <select name="branch" defaultValue={branchId ?? ''} className={inputClass}>
            <option value="">All branches</option>
            {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </label>
        <button type="submit" className={primaryButtonClass}>Apply</button>
        {filtered && <Link href="/inventory/write-offs" className={secondaryButtonClass}>Clear</Link>}
      </form>

      {writeOffs.length === 0 && (query.q || total > 0) ? (
        <ListEmptyState path={PATH} params={params} q={query.q} rowCount={writeOffs.length} total={total} noun="write-offs" />
      ) : writeOffs.length === 0 ? (
        filtered ? (
          <EmptyState icon={SearchX} title="No write-offs match these filters" action={{ href: '/inventory/write-offs', label: 'Clear filters' }} />
        ) : (
          <EmptyState
            icon={Trash2}
            title="No write-offs yet"
            action={canWriteOff ? { href: '/inventory/finished-goods', label: 'Open Finished Goods' } : undefined}
          >
            {canWriteOff ? 'Click Write off on a lot in Finished Goods.' : 'Production records write-offs here.'}
          </EmptyState>
        )
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <SortHeader label="Number" sortKey="number" firstDir="desc" {...header} />
                <SortHeader label="Finished good · lot" sortKey="good" {...header} />
                <SortHeader label="Quantity" sortKey="quantity" firstDir="desc" align="right" {...header} />
                <SortHeader label="Reason" sortKey="reason" {...header} />
                <SortHeader label="Value" sortKey="value" firstDir="desc" align="right" {...header} />
                <SortHeader label="Branch" sortKey="branch" {...header} />
                <SortHeader label="Recorded" sortKey="recorded" firstDir="desc" {...header} />
                <SortHeader label="Status" sortKey="status" {...header} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {writeOffs.map(row => (
                <tr key={row.id} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/inventory/write-offs/${row.id}`} className="font-mono text-xs text-orange-600 hover:text-orange-700 hover:underline">
                      {row.writeOffNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {row.finishedGoodName} <span className="font-mono text-xs text-gray-400">{row.lotNumber}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {formatQuantity(row.quantity)} <span className="text-gray-400">{row.unitAbbreviation}</span>
                  </td>
                  <td className="px-4 py-3"><WriteOffReasonBadge reason={row.reason} label={row.reasonLabel} /></td>
                  <td className="px-4 py-3 text-right">
                    {row.value === null
                      ? <span className="text-gray-400">—</span>
                      : row.valueRecorded
                        ? <span className="font-medium text-red-700">{formatPeso(row.value)}</span>
                        : <span className="text-gray-500" title="Estimate at the lot's cost — recorded when approved">≈ {formatPeso(row.value)}</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{row.branchName}</td>
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

      <Pagination path={PATH} params={params} page={query.page} pageSize={query.take} total={total} noun="write-offs" />
    </div>
  )
}
