import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSession } from '@/lib/session'
import { formatDateTime } from '@/lib/dates'
import { formatQuantity, trimDecimal } from '@/lib/format'
import { ConversionOrderService } from '@/services/conversion-order.service'
import { StatusBadge } from '@/components/procurement/StatusBadge'
import { ConversionEffect } from '@/components/production/ConversionEffect'
import { ConversionStock } from '@/components/production/ConversionStock'
import { ApprovalActions } from '@/components/procurement/ApprovalActions'
import { DecisionHistory } from '@/components/procurement/DecisionHistory'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function ConversionOrderDetailPage({ params }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  const { id } = await params

  const result = await ConversionOrderService.getById(id)
  if (!result.success) notFound()

  const order = result.data
  const unit  = order.unitAbbreviation
  // The BOM pages are production's (middleware); accounting reads the recipe
  // through the preview below instead of a link it could not open.
  const canConvert = session.role === 'ADMIN' || session.role === 'PRODUCTION_MANAGER'
  const isPending  = order.status === 'PENDING_APPROVAL'
  const isApprover = session.role === 'ACCOUNTING' || session.role === 'ADMIN'
  // Nobody decides a conversion they recorded, ADMIN included (D6).
  const isOwn      = order.submittedById === session.userId

  return (
    <div>
      <Link
        href="/production/conversions"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
      >
        <ArrowLeft size={15} />
        Conversions
      </Link>

      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-2xl font-bold text-gray-800">{order.orderNumber}</h1>
          <StatusBadge status={order.status} />
        </div>
        <p className="mt-1 text-sm text-gray-400">
          {order.finishedGoodName} <span className="font-mono">({order.finishedGoodCode})</span> from {order.sourceName}
          {' · '}
          {canConvert ? (
            <Link
              href={`/production/bom/${order.bomId}?qty=${encodeURIComponent(trimDecimal(order.expectedOutput))}`}
              className="text-orange-600 hover:underline"
            >
              Conversion v{order.bomVersion}
            </Link>
          ) : (
            <>Conversion v{order.bomVersion}</>
          )}
        </p>
      </div>

      <div className="mb-6 grid gap-4 rounded-xl border border-gray-200 bg-white p-4 text-sm sm:grid-cols-3">
        <Detail label="Made">
          <span className="font-medium">{formatQuantity(order.outputQty)} {unit} {order.finishedGoodName}</span>
          <span className="text-gray-400">
            {' '}· recipe expects {formatQuantity(order.expectedOutput)} {unit} ({trimDecimal(order.percentOfExpected)}%)
          </span>
        </Detail>
        <Detail label="From">
          <span className="font-medium">{formatQuantity(order.sourceQty)} {order.sourceUnitAbbreviation} {order.sourceName}</span>
        </Detail>
        <Detail label="Branch">{order.branchName}</Detail>
        <Detail label="Recorded by">{order.submittedByName}</Detail>
        <Detail label="Recorded">{formatDateTime(order.createdAt)}</Detail>
        <Detail label="Conversion date">{order.convertedOn}</Detail>
      </div>

      <DecisionHistory decisions={order.decisions} />

      {isPending && isApprover && isOwn && (
        <p className="mb-6 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
          You recorded this conversion, so someone else has to decide it.
        </p>
      )}
      {isPending && !isApprover && (
        <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Submitted — waiting for accounting&apos;s decision. Stock moves when they approve it.
        </p>
      )}

      {order.effect && (
        <ConversionEffect
          effect={order.effect}
          title="Approving this conversion"
          lotLabel={`lot ${order.orderNumber}`}
        />
      )}
      {/* D6: accounting decides, never whoever recorded it. */}
      {isPending && isApprover && !isOwn && (
        <ApprovalActions referenceType="ConversionOrder" referenceId={order.id} />
      )}
      {order.stockMoved && (
        <ConversionStock
          stock={order.stockMoved}
          cost={order.recordedCost}
          finishedGoodName={order.finishedGoodName}
          sourceName={order.sourceName}
        />
      )}
      {order.status === 'REJECTED' && (
        <p className="mb-6 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
          Rejected — nothing moved in stock. If the conversion did happen, production records it again with the right figures.
        </p>
      )}

      {order.notes && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Notes</p>
          <p className="text-sm text-gray-700">{order.notes}</p>
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
