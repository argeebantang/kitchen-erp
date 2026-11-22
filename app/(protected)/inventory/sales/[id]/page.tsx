import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { getSession } from '@/lib/session'
import { formatDateTime, shortDateLabel } from '@/lib/dates'
import { formatPeso, trimDecimal } from '@/lib/format'
import { OutletSaleService } from '@/services/outlet-sale.service'

type PageProps = { params: Promise<{ id: string }> }

/** One day's sales at an outlet (Week 10 Task 1): the lines, and the lots each was taken from. */
export default async function OutletSaleDetailPage({ params }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  const { id } = await params
  const sale = await OutletSaleService.getById(id, { userId: session.userId, role: session.role })
  if (!sale) notFound()

  return (
    <div>
      <Link href="/inventory/sales" className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700">
        <ChevronLeft size={16} /> Daily Sales
      </Link>
      <div className="mb-6">
        <h1 className="font-mono text-2xl font-bold text-gray-800">{sale.saleNumber}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {sale.branchName} · sold on {shortDateLabel(sale.soldOn)} · recorded by {sale.submittedByName}, {formatDateTime(sale.createdAt)}
        </p>
        {sale.notes && <p className="mt-2 text-sm text-gray-700">{sale.notes}</p>}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Takings</p>
          <p className="mt-1 text-xl font-semibold text-gray-800">{formatPeso(sale.totalAmount)}</p>
          <p className="text-xs text-gray-400">at the selling prices of the day</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Cost of goods sold</p>
          <p className="mt-1 text-xl font-semibold text-gray-800">{formatPeso(sale.totalCost)}</p>
          <p className="text-xs text-gray-400">at the lots&apos; recorded cost</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Gross margin</p>
          <p className="mt-1 text-xl font-semibold text-gray-800">{formatPeso(sale.grossMargin)}</p>
          <p className="text-xs text-gray-400">takings less cost</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">Finished good</th>
              <th className="px-4 py-3 text-right font-medium">Sold</th>
              <th className="px-4 py-3 text-right font-medium">Price</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Taken from lots</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sale.items.map(item => (
              <tr key={item.finishedGoodId} className="align-top">
                <td className="px-4 py-3">
                  <span className="font-medium text-gray-800">{item.name}</span>{' '}
                  <span className="font-mono text-xs text-gray-400">{item.code}</span>
                </td>
                <td className="px-4 py-3 text-right text-gray-700">{trimDecimal(item.quantity)} {item.unitAbbreviation}</td>
                <td className="px-4 py-3 text-right text-gray-500">{formatPeso(item.unitPrice)}</td>
                <td className="px-4 py-3 text-right font-medium text-gray-800">{formatPeso(item.amount)}</td>
                <td className="px-4 py-3 text-gray-600">
                  {item.lots.map(lot => (
                    <div key={lot.lotNumber}>
                      <span className="font-mono text-xs">{lot.lotNumber}</span> · {trimDecimal(lot.quantity)} {item.unitAbbreviation}
                      {lot.expiresAt && <span className="text-xs text-gray-400"> · expires {formatDateTime(lot.expiresAt)}</span>}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
