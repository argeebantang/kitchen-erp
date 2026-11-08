import Link from 'next/link'
import { Plus } from 'lucide-react'
import { trimDecimal } from '@/lib/format'
import { inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'
import { isProductionStatus, PRODUCTION_STATUSES, ProductionOrderService } from '@/services/production-order.service'
import { StatusBadge } from '@/components/procurement/StatusBadge'

const PAGE_SIZE = 50

type PageProps = {
  searchParams: Promise<{ status?: string; page?: string }>
}

export default async function ProductionOrderListPage({ searchParams }: PageProps) {
  // Filters arrive as plain query strings from the GET form below. An unknown
  // status is ignored rather than an error, so a stale link still opens.
  const { status: statusParam = '', page: pageParam } = await searchParams
  const status = isProductionStatus(statusParam) ? statusParam : undefined
  const page   = Math.max(1, Number.parseInt(pageParam ?? '1', 10) || 1)

  const { productionOrders, total } = await ProductionOrderService.list({
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
    return text ? `/production/orders?${text}` : '/production/orders'
  }

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

        <Link href="/production/orders/new" className={`inline-flex items-center gap-1.5 ${primaryButtonClass}`}>
          <Plus size={15} />
          New production order
        </Link>
      </div>

      {/* A GET form: the filter lives in the URL, so a filtered list can be linked to. */}
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
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

      {productionOrders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-gray-600">
            {status ? 'No production orders with this status' : 'No production orders yet'}
          </p>
          <p className="mt-1 text-sm text-gray-400">
            Click <span className="font-medium">New production order</span> to plan one.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Finished good</th>
                <th className="px-4 py-3 font-medium">BOM</th>
                <th className="px-4 py-3 text-right font-medium">Planned</th>
                <th className="px-4 py-3 font-medium">Production date</th>
                <th className="px-4 py-3 font-medium">Branch</th>
                <th className="px-4 py-3 font-medium">Requested by</th>
                <th className="px-4 py-3 font-medium">Status</th>
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

      {pageCount > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
          <span>Page {page} of {pageCount} · {total} orders</span>
          <div className="flex gap-2">
            {page > 1 && <Link href={pageHref(page - 1)} className={secondaryButtonClass}>Newer</Link>}
            {page < pageCount && <Link href={pageHref(page + 1)} className={secondaryButtonClass}>Older</Link>}
          </div>
        </div>
      )}
    </div>
  )
}
