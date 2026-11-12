import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSession } from '@/lib/session'
import { formatDateTime } from '@/lib/dates'
import { formatPeso, formatQuantity } from '@/lib/format'
import { WriteOffService } from '@/services/write-off.service'
import { StatusBadge } from '@/components/procurement/StatusBadge'
import { WriteOffReasonBadge } from '@/components/inventory/WriteOffReasonBadge'
import { ExpiryBadge } from '@/components/inventory/ExpiryBadge'
import { ApprovalActions } from '@/components/procurement/ApprovalActions'
import { DecisionHistory } from '@/components/procurement/DecisionHistory'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function WriteOffDetailPage({ params }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  const { id } = await params

  const result = await WriteOffService.getById(id)
  if (!result.success) notFound()

  const writeOff = result.data
  const unit       = writeOff.unitAbbreviation
  const isPending  = writeOff.status === 'PENDING_APPROVAL'
  const isApprover = session.role === 'ACCOUNTING' || session.role === 'ADMIN'
  // Nobody decides a write-off they recorded, ADMIN included (W4).
  const isOwn      = writeOff.submittedById === session.userId
  // Every role allowed here can open production orders and conversions.
  const source = writeOff.lot.source
  const sourceHref = source === null
    ? null
    : source.kind === 'PRODUCTION' ? `/production/orders/${source.id}` : `/production/conversions/${source.id}`

  return (
    <div>
      <Link
        href="/inventory/write-offs"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
      >
        <ArrowLeft size={15} />
        Write-offs
      </Link>

      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-bold text-gray-800">{writeOff.writeOffNumber}</h1>
          <StatusBadge status={writeOff.status} />
          <WriteOffReasonBadge reason={writeOff.reason} label={writeOff.reasonLabel} />
        </div>
        <p className="mt-1 text-sm text-gray-400">
          {formatQuantity(writeOff.quantity)} {unit} {writeOff.finishedGoodName} from lot{' '}
          {sourceHref
            ? <Link href={sourceHref} className="font-mono text-orange-600 hover:underline">{writeOff.lotNumber}</Link>
            : <span className="font-mono">{writeOff.lotNumber}</span>}
        </p>
      </div>

      <div className="mb-6 grid gap-4 rounded-xl border border-gray-200 bg-white p-4 text-sm sm:grid-cols-3">
        <Detail label="Quantity"><span className="font-medium">{formatQuantity(writeOff.quantity)} {unit}</span></Detail>
        <Detail label="Reason">{writeOff.reasonLabel}</Detail>
        <Detail label={writeOff.valueRecorded ? 'Value lost' : writeOff.status === 'REJECTED' ? 'Value' : 'Value (estimate)'}>
          {writeOff.value === null ? (
            <span className="text-gray-400">{writeOff.status === 'REJECTED' ? 'None — rejected' : '—'}</span>
          ) : (
            <>
              <span className={`font-medium ${writeOff.valueRecorded ? 'text-red-700' : 'text-gray-800'}`}>
                {writeOff.valueRecorded ? '' : '≈ '}{formatPeso(writeOff.value)}
              </span>
              {writeOff.unitCost !== null && (
                <span className="text-gray-400"> = {formatQuantity(writeOff.quantity)} {unit} × {formatPeso(writeOff.unitCost)}/{unit}</span>
              )}
            </>
          )}
        </Detail>
        <Detail label="Lot">
          <span className="font-mono">{writeOff.lotNumber}</span>
          <span className="text-gray-400"> · produced {writeOff.lot.producedOn}</span>
        </Detail>
        <Detail label="Lot expires">
          {writeOff.lot.expiresAt === null ? '—' : (
            <>
              <span className={writeOff.lot.expired ? 'font-medium text-red-700' : undefined}>{formatDateTime(writeOff.lot.expiresAt)}</span>
              {' '}<ExpiryBadge flag={writeOff.lot.expiry} />
            </>
          )}
        </Detail>
        <Detail label="Branch">{writeOff.branchName}</Detail>
        <Detail label="Recorded by">{writeOff.submittedByName}</Detail>
        <Detail label="Recorded">{formatDateTime(writeOff.createdAt)}</Detail>
      </div>

      <DecisionHistory decisions={writeOff.decisions} />

      {isPending && isApprover && isOwn && (
        <p className="mb-6 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
          You recorded this write-off, so someone else has to decide it.
        </p>
      )}
      {isPending && !isApprover && (
        <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Submitted — waiting for accounting&apos;s decision. It leaves stock when they approve it.
        </p>
      )}

      {/* W4: what approving does, then the decision — never by whoever recorded it. */}
      {isPending && isApprover && !isOwn && writeOff.effect && (
        <>
          <div className="mb-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p className="mb-1 font-semibold text-gray-800">Approving this write-off</p>
            <p className="text-gray-600">
              Takes <span className="font-medium text-red-700">−{formatQuantity(writeOff.quantity)} {unit}</span> out of lot{' '}
              <span className="font-mono">{writeOff.lotNumber}</span> at {writeOff.branchName}: {formatQuantity(writeOff.effect.onHand)} {unit} on hand now
              {' '}→ <span className="font-medium">{formatQuantity(writeOff.effect.after)} {unit}</span> after
              {writeOff.effect.value !== null && (
                <>, and records <span className="font-medium text-red-700">{formatPeso(writeOff.effect.value)}</span> written off at the lot&apos;s cost</>
              )}.
            </p>
            {!writeOff.effect.enough && (
              <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700">
                Approving will be refused: the lot holds less than {formatQuantity(writeOff.quantity)} {unit} now — it was used or
                written off since this was recorded. Reject it with a reason; production records what is left.
              </p>
            )}
            {writeOff.effect.value === null && (
              <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700">
                Approving will be refused: the lot has no recorded cost, so the write-off cannot be costed.
              </p>
            )}
          </div>
          <ApprovalActions referenceType="WriteOff" referenceId={writeOff.id} />
        </>
      )}

      {writeOff.stockMoved && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 text-sm">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Stock moved</p>
          <p>
            <span className="font-medium text-red-700">{formatQuantity(writeOff.stockMoved.quantity).replace(/^-/, '−')} {writeOff.stockMoved.unitAbbreviation}</span>
            <span className="text-gray-700"> {writeOff.finishedGoodName}</span>
            <span className="text-gray-400"> · lot <span className="font-mono">{writeOff.stockMoved.lotNumber}</span> · {writeOff.stockMoved.branchName} · {formatDateTime(writeOff.stockMoved.at)}</span>
            {writeOff.stockMoved.unitCost !== null && (
              <span className="text-gray-500"> @ {formatPeso(writeOff.stockMoved.unitCost)}/{writeOff.stockMoved.unitAbbreviation}</span>
            )}
          </p>
          {writeOff.value !== null && writeOff.valueRecorded && (
            <p className="mt-2 border-t border-gray-100 pt-2 text-gray-700">
              Value written off: <span className="font-medium text-red-700">{formatPeso(writeOff.value)}</span>
            </p>
          )}
        </div>
      )}
      {writeOff.status === 'REJECTED' && (
        <p className="mb-6 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
          Rejected — nothing left stock. If the food was thrown away, production records it again with the right figures.
        </p>
      )}

      {writeOff.notes && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Notes</p>
          <p className="text-sm text-gray-700">{writeOff.notes}</p>
        </div>
      )}
    </div>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-gray-800">{children}</p>
    </div>
  )
}
