import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Pencil } from 'lucide-react'
import { getSession } from '@/lib/session'
import { ReceivingReportService, type ReceivingReportDetailDto } from '@/services/receiving-report.service'
import { StatusBadge } from '@/components/procurement/StatusBadge'
import { VarianceChips } from '@/components/procurement/VarianceChips'
import { ReceivingReportActions } from '@/components/procurement/ReceivingReportActions'
import { ApprovalActions } from '@/components/procurement/ApprovalActions'
import { DecisionHistory } from '@/components/procurement/DecisionHistory'
import { formatPeso, trimDecimal } from '@/lib/format'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function ReceivingReportDetailPage({ params }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  const { id } = await params

  const result = await ReceivingReportService.getById(id)
  if (!result.success) notFound()

  const rr = result.data
  // Same roles ReceivingReportService.update and submit accept. Middleware
  // already keeps everyone else off this page; this is ready for Task 3, when
  // accounting is let in to approve.
  const canEdit = rr.status === 'DRAFT' && (session.role === 'PROCUREMENT_MANAGER' || session.role === 'ADMIN')
  // The roles middleware lets onto /api/approvals. Nobody decides their own
  // count, ADMIN included — the service refuses it too.
  const isPending  = rr.status === 'PENDING_APPROVAL'
  const isApprover = session.role === 'ACCOUNTING' || session.role === 'ADMIN'
  const isOwnCount = rr.receivedById === session.userId

  return (
    <div>
      <Link
        href="/procurement/receiving"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
      >
        <ArrowLeft size={15} />
        Receiving
      </Link>

      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-2xl font-bold text-gray-800">{rr.rrNumber}</h1>
          <StatusBadge status={rr.status} />
          {canEdit && (
            <Link
              href={`/procurement/receiving/${rr.id}/edit`}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-orange-200 bg-white px-3 py-1.5 text-sm font-medium text-orange-600 transition-colors hover:bg-orange-50"
            >
              <Pencil size={15} />
              Edit
            </Link>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-400">
          {'Against '}
          <Link href={`/procurement/orders/${rr.purchaseOrderId}`} className="font-mono text-orange-600 hover:underline">
            {rr.poNumber}
          </Link>
          {' '}<StatusBadge status={rr.poStatus} />
          {rr.supplierName && <> · {rr.supplierName}</>}
        </p>
      </div>

      <div className="mb-6 grid gap-4 rounded-xl border border-gray-200 bg-white p-4 text-sm sm:grid-cols-3">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Received at</p>
          <p className="text-gray-800">{rr.branchName}</p>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Received on</p>
          <p className="text-gray-800">{rr.receivedAt.slice(0, 10)}</p>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Counted by</p>
          <p className="text-gray-800">{rr.receivedByName}</p>
        </div>
      </div>

      {canEdit && <ReceivingReportActions receivingReportId={rr.id} />}

      {isPending && isApprover && !isOwnCount && (
        <ApprovalActions referenceType="ReceivingReport" referenceId={rr.id} />
      )}
      {isPending && isApprover && isOwnCount && (
        <p className="mb-6 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
          You counted this delivery, so someone else has to decide it.
        </p>
      )}
      {isPending && !isApprover && (
        <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Submitted — waiting for accounting&apos;s decision. Nothing reaches stock until it is approved.
        </p>
      )}

      <DecisionHistory decisions={rr.decisions} />

      {rr.notes && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Notes</p>
          <p className="text-sm text-gray-700">{rr.notes}</p>
        </div>
      )}

      <VarianceBanner
        variance={rr.variance}
        lineTotal={rr.lines.length}
        poNumber={rr.poNumber}
      />

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">Material</th>
              <th className="px-4 py-3 text-right font-medium">Ordered</th>
              <th className="px-4 py-3 text-right font-medium">Expected</th>
              <th className="px-4 py-3 text-right font-medium">Received</th>
              <th className="px-4 py-3 text-right font-medium">Rejected</th>
              <th className="px-4 py-3 text-right font-medium">Accepted</th>
              <th className="px-4 py-3 font-medium">Variance</th>
              <th className="px-4 py-3 text-right font-medium">Unit cost</th>
              <th className="px-4 py-3 text-right font-medium">Accepted value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rr.lines.map(line => {
              const unit = <span className="text-gray-400">{line.unitAbbreviation}</span>
              return (
                <tr key={line.id}>
                  <td className="px-4 py-3">
                    <p className="text-gray-700">{line.materialName}</p>
                    <p className="font-mono text-xs text-gray-400">{line.materialCode}</p>
                    {line.notes && <p className="mt-1 text-xs text-gray-500">{line.notes}</p>}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">{trimDecimal(line.orderedQuantity)} {unit}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{trimDecimal(line.expectedQuantity)} {unit}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{trimDecimal(line.receivedQuantity)} {unit}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{trimDecimal(line.rejectedQuantity)} {unit}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-800">{trimDecimal(line.acceptedQuantity)} {unit}</td>
                  <td className="px-4 py-3">
                    <VarianceChips unit={line.unitAbbreviation} {...line.variance} />
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">{formatPeso(line.unitCost)}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{formatPeso(line.acceptedValue)}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="border-t border-gray-200 bg-gray-50">
            <tr>
              <td colSpan={8} className="px-4 py-3 text-right text-sm text-gray-500">
                Value accepted into stock on approval
              </td>
              <td className="px-4 py-3 text-right text-sm font-semibold text-gray-800">
                {formatPeso(rr.acceptedValue)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <StockCard status={rr.status} movements={rr.stockMovements} />
    </div>
  )
}

/**
 * What this report put into stock — the StockMovement rows its approval
 * wrote, read back rather than inferred from the lines, so the card shows the
 * ledger as it is.
 */
function StockCard({
  status,
  movements,
}: {
  status: ReceivingReportDetailDto['status']
  movements: ReceivingReportDetailDto['stockMovements']
}) {
  const empty =
    status === 'REJECTED'      ? 'Rejected — nothing was added to stock.'
    : status === 'APPROVED'    ? 'Approved, but every line was rejected — nothing was added to stock.'
    : 'Nothing added to stock yet — that happens when accounting approves this report.'

  return (
    <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Stock</p>
      {movements.length === 0 ? (
        <p className="text-sm text-gray-500">{empty}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {movements.map(movement => (
            <li key={movement.id} className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-emerald-700">
                +{trimDecimal(movement.quantity)} {movement.unitAbbreviation}
              </span>
              <span className="text-gray-700">{movement.materialName}</span>
              {movement.unitCost !== null && (
                <span className="text-gray-500">@ {formatPeso(movement.unitCost)}/{movement.unitAbbreviation}</span>
              )}
              <span className="font-mono text-xs text-gray-400">{movement.materialCode}</span>
              <span className="text-gray-400">
                → {movement.branchName} · {movement.type} · {movement.createdAt.slice(0, 10)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function VarianceBanner({
  variance,
  lineTotal,
  poNumber,
}: {
  variance: ReceivingReportDetailDto['variance']
  lineTotal: number
  poNumber: string
}) {
  if (variance.lineCount === 0) {
    return (
      <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <span className="font-medium">No variance.</span> Every line matches what was expected, and nothing was rejected.
      </div>
    )
  }

  const totals = [
    { label: 'short',          value: variance.shortValue },
    { label: 'over-delivered', value: variance.overValue },
    { label: 'rejected',       value: variance.rejectedValue },
  ].filter(total => Number(total.value) !== 0)

  return (
    <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <span className="font-medium">
        Variance on {variance.lineCount} of {lineTotal} {lineTotal === 1 ? 'line' : 'lines'}
      </span>
      {' — '}
      {totals.map(total => `${formatPeso(total.value)} ${total.label}`).join(' · ')}.
      {Number(variance.shortValue) !== 0 && <> Short quantities stay outstanding on {poNumber}.</>}
    </div>
  )
}
