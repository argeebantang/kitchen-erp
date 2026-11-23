import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { shortDateLabel } from '@/lib/dates'
import { formatPeso } from '@/lib/format'
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'
import { OutletSaleService, SALES_PAGE_SIZE } from '@/services/outlet-sale.service'
import { EmptyState } from '@/components/ui/states'
import { Store, Receipt } from 'lucide-react'
import { PendingSpinner } from '@/components/ui/PendingSpinner'

type PageProps = {
  searchParams: Promise<{ page?: string }>
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

  const { page: pageParam = '1' } = await searchParams
  const page = Math.max(1, Number.parseInt(pageParam, 10) || 1)
  const result = await OutletSaleService.list(viewer, page)
  const canRecord = session.role === 'ADMIN' || session.role === 'BRANCH_MANAGER'
  const pages = result ? Math.max(1, Math.ceil(result.total / SALES_PAGE_SIZE)) : 1

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

      {!result ? (
        <EmptyState icon={Store} title="You do not run an outlet">
          Daily sales are kept per outlet.
        </EmptyState>
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
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Sold on</th>
                <th className="px-4 py-3 font-medium">Outlet</th>
                <th className="px-4 py-3 text-right font-medium">Goods</th>
                <th className="px-4 py-3 text-right font-medium">Takings</th>
                <th className="px-4 py-3 text-right font-medium">Cost of goods</th>
                <th className="px-4 py-3 font-medium">Recorded by</th>
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

      {result && pages > 1 && (
        <div className="mt-4 flex items-center gap-3 text-sm text-gray-500">
          {page > 1 && <Link href={`/inventory/sales?page=${page - 1}`} className={secondaryButtonClass}>Newer<PendingSpinner /></Link>}
          <span>Page {page} of {pages}</span>
          {page < pages && <Link href={`/inventory/sales?page=${page + 1}`} className={secondaryButtonClass}>Older<PendingSpinner /></Link>}
        </div>
      )}
    </div>
  )
}
