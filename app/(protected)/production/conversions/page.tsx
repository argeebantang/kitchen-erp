import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Plus } from 'lucide-react'
import { getSession } from '@/lib/session'
import { formatDateTime } from '@/lib/dates'
import { formatQuantity } from '@/lib/format'
import { inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'
import { CONVERSION_STATUSES, ConversionOrderService, isConversionStatus } from '@/services/conversion-order.service'
import { StatusBadge } from '@/components/procurement/StatusBadge'

const PAGE_SIZE = 50

type PageProps = {
  searchParams: Promise<{ status?: string; page?: string }>
}

export default async function ConversionOrderListPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  // Accounting reads this list to decide; /production/conversions/new is production's.
  const canConvert = session.role === 'ADMIN' || session.role === 'PRODUCTION_MANAGER'

  // An unknown status is ignored rather than an error, so a stale link still opens.
  const { status: statusParam = '', page: pageParam } = await searchParams
  const status = isConversionStatus(statusParam) ? statusParam : undefined
  const page   = Math.max(1, Number.parseInt(pageParam ?? '1', 10) || 1)

  const { conversionOrders, total } = await ConversionOrderService.list({
    status,
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  })
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const pageHref = (target: number) => {
    const query = new URLSearchParams()
    if (status) query.set('status', status)
    if (target > 1) query.set('page', String(target))
    const text = query.toString()
    return text ? `/production/conversions?${text}` : '/production/conversions'
  }

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

      {conversionOrders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-gray-600">
            {status ? 'No conversions with this status' : 'No conversions yet'}
          </p>
          <p className="mt-1 text-sm text-gray-400">
            {canConvert ? <>Click <span className="font-medium">Record Conversion</span> after the kitchen converts something.</> : 'Production records conversions here.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 text-right font-medium">Made</th>
                <th className="px-4 py-3 text-right font-medium">From</th>
                <th className="px-4 py-3 font-medium">Branch</th>
                <th className="px-4 py-3 font-medium">Recorded</th>
                <th className="px-4 py-3 font-medium">By</th>
                <th className="px-4 py-3 font-medium">Status</th>
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

      {pageCount > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
          <span>Page {page} of {pageCount} · {total} conversions</span>
          <div className="flex gap-2">
            {page > 1 && <Link href={pageHref(page - 1)} className={secondaryButtonClass}>Newer</Link>}
            {page < pageCount && <Link href={pageHref(page + 1)} className={secondaryButtonClass}>Older</Link>}
          </div>
        </div>
      )}
    </div>
  )
}
