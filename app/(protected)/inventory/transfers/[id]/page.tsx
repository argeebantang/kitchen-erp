import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSession } from '@/lib/session'
import { formatDateTime } from '@/lib/dates'
import { formatPeso, formatQuantity } from '@/lib/format'
import { StockTransferService } from '@/services/stock-transfer.service'
import { StatusBadge } from '@/components/procurement/StatusBadge'
import { ExpiryBadge } from '@/components/inventory/ExpiryBadge'
import { TransferStock } from '@/components/inventory/TransferStock'
import { DecisionHistory } from '@/components/procurement/DecisionHistory'
import { ApprovalActions } from '@/components/procurement/ApprovalActions'
import { ConfirmReceiptButton } from '@/components/inventory/ConfirmReceiptButton'

type PageProps = {
  params: Promise<{ id: string }>
}

/**
 * One Transfer Order (Week 8 Tasks 2–3). While it waits for accounting, each
 * line is shown against the sender's stock now: the lots approving now would
 * take, soonest expiry first, and their value (T7). Once approved it is in
 * transit — what left the sender is under Stock moved — until the receiving
 * branch confirms it arrived.
 */
export default async function TransferDetailPage({ params }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  const { id } = await params

  const result = await StockTransferService.getById(id, { userId: session.userId, role: session.role })
  if (!result.success) notFound()

  const transfer = result.data
  const plan     = transfer.plan
  const isApprover = session.role === 'ACCOUNTING' || session.role === 'ADMIN'
  // Nobody decides a transfer they recorded, ADMIN included (R1).
  const isOwn      = transfer.submittedById === session.userId

  return (
    <div>
      <Link
        href="/inventory/transfers"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
      >
        <ArrowLeft size={15} />
        Transfers
      </Link>

      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-2xl font-bold text-gray-800">{transfer.transferNumber}</h1>
          <StatusBadge status={transfer.status} />
        </div>
        <p className="mt-1 text-sm text-gray-400">
          {transfer.fromBranch.name} <span className="text-gray-300">→</span> {transfer.toBranch.name}
        </p>
      </div>

      <div className="mb-6 grid gap-4 rounded-xl border border-gray-200 bg-white p-4 text-sm sm:grid-cols-3">
        <Detail label="From">{transfer.fromBranch.name} <span className="font-mono text-xs text-gray-400">{transfer.fromBranch.code}</span></Detail>
        <Detail label="To">{transfer.toBranch.name} <span className="font-mono text-xs text-gray-400">{transfer.toBranch.code}</span></Detail>
        <Detail label="Recorded">
          {formatDateTime(transfer.createdAt)}
          <span className="block text-xs text-gray-400">by {transfer.submittedByName}</span>
        </Detail>
        {transfer.receivedAt && (
          <Detail label="Received">
            {formatDateTime(transfer.receivedAt)}
            {transfer.receivedByName && <span className="block text-xs text-gray-400">confirmed by {transfer.receivedByName}</span>}
          </Detail>
        )}
        {transfer.notes && (
          <div className="sm:col-span-3">
            <Detail label="Notes"><span className="whitespace-pre-line">{transfer.notes}</span></Detail>
          </div>
        )}
      </div>

      <DecisionHistory decisions={transfer.decisions} />

      {transfer.status === 'APPROVED' && (
        <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-3 text-sm text-sky-800">
          <p>
            In transit: it left {transfer.fromBranch.name} when accounting approved it, and joins {transfer.toBranch.name}&apos;s stock
            when the branch confirms it arrived.
          </p>
          {/* R3: the receiving branch's manager, or an admin. Everything dispatched, for now (R4). */}
          {transfer.canReceive && (
            <div className="mt-3">
              <ConfirmReceiptButton
                transferId={transfer.id}
                transferNumber={transfer.transferNumber}
                branchName={transfer.toBranch.name}
              />
            </div>
          )}
        </div>
      )}
      {transfer.status === 'RECEIVED' && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Received at {transfer.toBranch.name}{transfer.receivedAt && <> on {formatDateTime(transfer.receivedAt)}</>}
          {transfer.receivedByName && <>, confirmed by {transfer.receivedByName}</>}.
        </div>
      )}

      {plan && (
        <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${plan.allEnough ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {plan.allEnough
            ? <>Waiting for accounting. Nothing has moved yet — approving sends the lots below from {transfer.fromBranch.name}, soonest to expire first.</>
            : <>
                Waiting for accounting, but {transfer.fromBranch.name} does not have enough for every line once what other documents
                awaiting approval have claimed is counted (marked below). Approving takes the stock if the lots still hold it — leaving
                those documents short — and is refused if they do not.
              </>}
        </div>
      )}
      {plan && isApprover && isOwn && (
        <p className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
          You recorded this transfer, so someone else in accounting has to decide it.
        </p>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-800">Goods</h2>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Finished good</th>
                <th className="px-4 py-3 text-right font-medium">Quantity</th>
                {plan && (
                  <>
                    <th className="px-4 py-3 text-right font-medium">Available now</th>
                    <th className="px-4 py-3 font-medium">Lots it would take</th>
                    <th className="px-4 py-3 text-right font-medium">Value at cost</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {transfer.lines.map(line => {
                const linePlan = plan?.lines.find(candidate => candidate.finishedGoodId === line.finishedGoodId)
                return (
                  <tr key={line.finishedGoodId} className={linePlan && !linePlan.enough ? 'bg-red-50/60' : ''}>
                    <td className="px-4 py-3 align-top text-gray-800">
                      {line.finishedGoodName} <span className="font-mono text-xs text-gray-400">{line.finishedGoodCode}</span>
                    </td>
                    <td className="px-4 py-3 text-right align-top font-medium tabular-nums text-gray-800">
                      {formatQuantity(line.quantity)} {line.unitAbbreviation}
                    </td>
                    {plan && (
                      <>
                        <td className="px-4 py-3 text-right align-top tabular-nums">
                          {linePlan && (
                            <>
                              <span className={linePlan.enough ? 'text-gray-800' : 'text-red-600'}>
                                {formatQuantity(linePlan.available)} {linePlan.unitAbbreviation}
                              </span>
                              {(Number(linePlan.claimed) > 0 || Number(linePlan.expiredOnHand) > 0) && (
                                <span className="block text-xs text-gray-400">
                                  {formatQuantity(linePlan.unexpiredOnHand)} on hand
                                  {Number(linePlan.claimed) > 0 && <> · {formatQuantity(linePlan.claimed)} claimed by others</>}
                                  {Number(linePlan.expiredOnHand) > 0 && <> · {formatQuantity(linePlan.expiredOnHand)} expired</>}
                                </span>
                              )}
                            </>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          {linePlan?.lots.map(lot => (
                            <span key={lot.lotNumber} className="flex items-center gap-1.5 whitespace-nowrap text-xs text-gray-600">
                              <span className="font-mono">{lot.lotNumber}</span>
                              <span>{formatQuantity(lot.take)} {linePlan.unitAbbreviation}</span>
                              <ExpiryBadge flag={lot.expiry} />
                            </span>
                          ))}
                          {linePlan && !linePlan.enough && (
                            <span className="mt-1 block text-xs font-medium text-red-700">
                              Short {formatQuantity(linePlan.short)} {linePlan.unitAbbreviation}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right align-top tabular-nums text-gray-800">
                          {linePlan?.value != null ? formatPeso(linePlan.value) : <span className="text-gray-400">—</span>}
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
            {plan?.totalValue != null && (
              <tfoot className="border-t border-gray-200 bg-gray-50">
                <tr>
                  <td colSpan={4} className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Total value at cost</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-gray-800">{formatPeso(plan.totalValue)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {/* R1: the decision, under the goods it sends — never by whoever recorded it. */}
      {plan && isApprover && !isOwn && (
        <section className="mt-6">
          <p className="mb-2 text-sm text-gray-600">
            Approving dispatches it: the lots leave {transfer.fromBranch.name} now and travel to {transfer.toBranch.name}.
            Rejecting is final — production records a new transfer.
          </p>
          <ApprovalActions referenceType="StockTransfer" referenceId={transfer.id} />
        </section>
      )}

      <TransferStock transfer={transfer} />
    </div>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-0.5 text-gray-800">{children}</p>
    </div>
  )
}
