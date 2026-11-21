import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSession } from '@/lib/session'
import { formatDateTime, shortDateLabel } from '@/lib/dates'
import { formatQuantity } from '@/lib/format'
import { StockRequestService } from '@/services/stock-request.service'
import { StatusBadge } from '@/components/procurement/StatusBadge'
import { LateBadge } from '@/components/inventory/LateBadge'
import { StockRequestDecision } from '@/components/inventory/StockRequestDecision'
import { primaryButtonClass } from '@/components/ui/form'

type PageProps = { params: Promise<{ id: string }> }

const STATUS_TEXT: Record<string, string> = {
  SUBMITTED:        'Waiting for the kitchen to plan it.',
  PLANNED:          'The kitchen will send it.',
  DECLINED:         'The kitchen will not send it.',
  FULFILLED:        'Delivered: everything asked for arrived.',
  PARTLY_FULFILLED: 'Delivered, but less than asked arrived.',
}

/**
 * One stock request (Week 9 Task 10): what was asked, what the kitchen will
 * send and why any line was cut, what arrived, and its delivery. The kitchen
 * answers it here and sends it from here; the outlet follows it.
 */
export default async function StockRequestPage({ params }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  const { id } = await params

  const result = await StockRequestService.getById(id, { userId: session.userId, role: session.role })
  if (!result.success) notFound()
  const request = result.data
  const showPlanned  = request.lines.some(line => line.plannedQuantity !== null)
  const showReceived = request.lines.some(line => line.received !== null)

  return (
    <div>
      <Link href="/inventory/requests" className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700">
        <ArrowLeft size={15} />
        Stock requests
      </Link>

      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-2xl font-bold text-gray-800">{request.requestNumber}</h1>
          <StatusBadge status={request.status} />
          {request.late && <LateBadge />}
        </div>
        <p className="mt-1 text-sm text-gray-400">
          {request.branch.name} <span className="text-gray-300">asks</span> {request.kitchen.name} · needed {shortDateLabel(request.neededOn)}
        </p>
      </div>

      <div className="mb-6 grid gap-4 rounded-xl border border-gray-200 bg-white p-4 text-sm sm:grid-cols-3">
        <Detail label="Outlet">{request.branch.name} <span className="font-mono text-xs text-gray-400">{request.branch.code}</span></Detail>
        <Detail label="Kitchen">{request.kitchen.name} <span className="font-mono text-xs text-gray-400">{request.kitchen.code}</span></Detail>
        <Detail label="Submitted">
          {formatDateTime(request.createdAt)}
          <span className="block text-xs text-gray-400">by {request.submittedByName}{request.late ? ' — after the cut-off' : ''}</span>
        </Detail>
        {request.notes && (
          <div className="sm:col-span-3"><Detail label="Outlet's note"><span className="whitespace-pre-line">{request.notes}</span></Detail></div>
        )}
      </div>

      <div className={`mb-6 rounded-lg border px-3 py-2 text-sm ${
        request.status === 'DECLINED' ? 'border-red-200 bg-red-50 text-red-700'
          : request.status === 'PARTLY_FULFILLED' ? 'border-amber-200 bg-amber-50 text-amber-800'
          : 'border-sky-200 bg-sky-50 text-sky-800'
      }`}>
        <p>
          {STATUS_TEXT[request.status]}
          {request.decidedByName && request.decidedAt && <> {request.status === 'DECLINED' ? 'Declined' : 'Planned'} by {request.decidedByName}, {formatDateTime(request.decidedAt)}.</>}
        </p>
        {request.kitchenNote && <p className="mt-1 font-medium">Kitchen&apos;s note: {request.kitchenNote}</p>}
      </div>

      {request.canDecide && <StockRequestDecision requestId={request.id} lines={request.lines} />}

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold text-gray-800">Goods</h2>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Finished good</th>
                <th className="px-4 py-2 text-right font-medium">Asked</th>
                {showPlanned && <th className="px-4 py-2 text-right font-medium">Will send</th>}
                {showReceived && <th className="px-4 py-2 text-right font-medium">Arrived</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {request.lines.map(line => {
                const cut = line.plannedQuantity !== null && Number(line.plannedQuantity) < Number(line.quantity)
                const short = line.received !== null && Number(line.received) < Number(line.quantity)
                return (
                  <tr key={line.itemId}>
                    <td className="px-4 py-2 text-gray-800">{line.finishedGoodName} <span className="font-mono text-xs text-gray-400">{line.finishedGoodCode}</span></td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatQuantity(line.quantity)} {line.unitAbbreviation}</td>
                    {showPlanned && (
                      <td className={`px-4 py-2 text-right tabular-nums ${cut ? 'font-medium text-amber-700' : ''}`}>
                        {line.plannedQuantity === null ? '—' : `${formatQuantity(line.plannedQuantity)} ${line.unitAbbreviation}`}
                      </td>
                    )}
                    {showReceived && (
                      <td className={`px-4 py-2 text-right tabular-nums ${short ? 'font-medium text-amber-700' : 'text-emerald-700'}`}>
                        {formatQuantity(line.received ?? '0')} {line.unitAbbreviation}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold text-gray-800">Delivery</h2>
        {request.transfers.length > 0 && (
          <ul className="mb-3 space-y-1 text-sm">
            {request.transfers.map(transfer => (
              <li key={transfer.id}>
                <Link href={`/inventory/transfers/${transfer.id}`} className="font-mono text-xs text-orange-600 hover:underline">{transfer.transferNumber}</Link>{' '}
                <StatusBadge status={transfer.status} />
                {transfer.status === 'REJECTED' && (
                  <span className="ml-2 text-xs text-gray-500">rejected by accounting{request.canSend ? ' — the request can be sent again' : ''}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {request.canSend ? (
          <Link href={`/inventory/transfers/new?request=${request.id}`} className={primaryButtonClass}>
            Send the delivery
          </Link>
        ) : request.transfers.length === 0 && (
          <p className="text-sm text-gray-400">
            {request.status === 'SUBMITTED' ? 'Sent once the kitchen plans it.' : request.status === 'DECLINED' ? 'Nothing will be sent.' : 'No delivery yet.'}
          </p>
        )}
      </section>
    </div>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-0.5 text-gray-800">{children}</p>
    </div>
  )
}
