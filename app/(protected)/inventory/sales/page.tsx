import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { shortDateLabel } from '@/lib/dates'
import { formatPeso } from '@/lib/format'
import { primaryButtonClass } from '@/components/ui/form'
import { OUTLET_SALE_SORT_KEYS, OutletSaleService } from '@/services/outlet-sale.service'
import { EmptyState } from '@/components/ui/states'
import { Store, Receipt } from 'lucide-react'
import { ListEmptyState, Pagination, SortHeader } from '@/components/ui/ListControls'
import { SearchBox } from '@/components/ui/SearchBox'
import { parseListQuery } from '@/lib/list-query'

const PATH = '/inventory/sales'

type PageProps = {
  searchParams: Promise<{ page?: string; q?: string; sort?: string; dir?: string }>
}

/**
 * Daily sales (Week 10 Task 1): every outlet's recorded days, newest first.
 * A branch manager sees only their outlet's; the kitchen and accounting see
 * all. Recording is for the outlet's manager or an admin.
 */
export default async function OutletSaleListPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  const viewer = { userId: session.userId, role: session.role }

  // Paging, search and sort live in the URL (lib/list-query.ts); the database does all three.
  const params = await searchParams
  const query  = parseListQuery(params, { sorts: OUTLET_SALE_SORT_KEYS, defaultSort: { key: 'soldOn', dir: 'desc' } })
  const header = { sort: query.sort, path: PATH, params }
  const result = await OutletSaleService.list(viewer, { skip: query.skip, take: query.take, search: query.q || undefined, listSort: query.sort })
  const canRecord = session.role === 'ADMIN' || session.role === 'BRANCH_MANAGER'

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Daily Sales</h1>
          <p className="mt-1 text-sm text-gray-400">
            What each outlet sold, recorded at closing. Sold goods leave the outlet&apos;s stock.
          </p>
        </div>
        {canRecord && result && <Link href="/inventory/sales/new" className={primaryButtonClass}>Record sales</Link>}
      </div>

      {result && (
        <div className="mb-4">
          <SearchBox placeholder="Search number, outlet, person" />
        </div>
      )}

      {!result ? (
        <EmptyState icon={Store} title="You do not run an outlet">
          Daily sales are kept per outlet.
        </EmptyState>
      ) : result.rows.length === 0 && (query.q || result.total > 0) ? (
        <ListEmptyState path={PATH} params={params} q={query.q} rowCount={result.rows.length} total={result.total} noun="sales" />
      ) : result.rows.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No sales recorded yet"
          action={canRecord ? { href: '/inventory/sales/new', label: 'Record sales' } : undefined}
        >
          {canRecord ? 'Record what sold at closing; the goods leave the outlet\'s stock, soonest expiry first.' : null}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <SortHeader label="Number" sortKey="number" firstDir="desc" {...header} />
                <SortHeader label="Sold on" sortKey="soldOn" firstDir="desc" {...header} />
                <SortHeader label="Outlet" sortKey="outlet" {...header} />
                <th className="px-4 py-3 text-right font-medium">Goods</th>
                <SortHeader label="Takings" sortKey="takings" firstDir="desc" align="right" {...header} />
                <SortHeader label="Cost of goods" sortKey="cost" firstDir="desc" align="right" {...header} />
                <SortHeader label="Recorded by" sortKey="by" {...header} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {result.rows.map(row => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/inventory/sales/${row.id}`} className="font-mono font-medium text-orange-600 hover:underline">{row.saleNumber}</Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">{shortDateLabel(row.soldOn)}</td>
                  <td className="px-4 py-3 text-gray-700">{row.branchName}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{row.lineCount}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-800">{formatPeso(row.totalAmount)}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{formatPeso(row.totalCost)}</td>
                  <td className="px-4 py-3 text-gray-500">{row.submittedByName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result && <Pagination path={PATH} params={params} page={query.page} pageSize={query.take} total={result.total} noun="sales" />}
    </div>
  )
}
