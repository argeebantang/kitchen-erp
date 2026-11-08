import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Pencil } from 'lucide-react'
import { getSession } from '@/lib/session'
import { trimDecimal } from '@/lib/format'
import { ProductionOrderService } from '@/services/production-order.service'
import { StatusBadge } from '@/components/procurement/StatusBadge'
import { MaterialRequirementsTable } from '@/components/production/MaterialRequirementsTable'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function ProductionOrderDetailPage({ params }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  const { id } = await params

  const result = await ProductionOrderService.getById(id)
  if (!result.success) notFound()

  const order = result.data
  const unit  = order.unitAbbreviation
  const isDraft = order.status === 'DRAFT'
  // Same roles ProductionOrderService.update accepts; ready for Task 5, when
  // accounting is let in to read.
  const canEdit = isDraft && (session.role === 'PRODUCTION_MANAGER' || session.role === 'ADMIN')

  return (
    <div>
      <Link
        href="/production/orders"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
      >
        <ArrowLeft size={15} />
        Production orders
      </Link>

      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-2xl font-bold text-gray-800">{order.orderNumber}</h1>
          <StatusBadge status={order.status} />
          {canEdit && (
            <Link
              href={`/production/orders/${order.id}/edit`}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-orange-200 bg-white px-3 py-1.5 text-sm font-medium text-orange-600 transition-colors hover:bg-orange-50"
            >
              <Pencil size={15} />
              Edit
            </Link>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-400">
          {order.finishedGoodName} <span className="font-mono">({order.finishedGoodCode})</span>
          {' · '}
          {/* The BOM viewer scaled to this order's output — the ingredient list Task 2 builds on. */}
          <Link
            href={`/production/bom/${order.bomId}?qty=${encodeURIComponent(trimDecimal(order.plannedQty))}`}
            className="text-orange-600 hover:underline"
          >
            BOM v{order.bomVersion}
          </Link>
        </p>
      </div>

      {/* D9: a draft re-pins to the active version on every save, so say what a save would change. */}
      {!order.bomIsActive && (
        <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          BOM v{order.bomVersion} has been superseded
          {order.activeBomVersion === null
            ? ', and this finished good has no active BOM now.'
            : ` by v${order.activeBomVersion}.`}
          {isDraft && (order.activeBomVersion === null
            ? ' The draft cannot be saved again until one is created.'
            : ` Saving the draft switches it to v${order.activeBomVersion}.`)}
        </p>
      )}

      <div className="mb-6 grid gap-4 rounded-xl border border-gray-200 bg-white p-4 text-sm sm:grid-cols-3">
        <Detail label="Planned output">
          <span className="font-medium">{trimDecimal(order.plannedQty)} {unit}</span>
          <span className="text-gray-400">
            {' '}= {order.batchCount} {order.batchCount === 1 ? 'batch' : 'batches'} × {trimDecimal(order.batchWeight)} {unit}
          </span>
        </Detail>
        <Detail label="Production date">{order.plannedDate}</Detail>
        <Detail label="Branch">{order.branchName}</Detail>
        <Detail label="Requested by">{order.requestedByName}</Detail>
        <Detail label="Created">{order.createdAt.slice(0, 10)}</Detail>
        <Detail label="Last saved">{order.updatedAt.slice(0, 10)}</Detail>
      </div>

      {order.notes && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Notes</p>
          <p className="text-sm text-gray-700">{order.notes}</p>
        </div>
      )}

      <h2 className="mb-1 text-lg font-semibold text-gray-800">Materials required</h2>
      <p className="mb-3 text-sm text-gray-400">
        {order.requirements.length} {order.requirements.length === 1 ? 'ingredient' : 'ingredients'} from BOM
        v{order.bomVersion}, scaled to this order.
        {order.requirements.some(line => line.stock !== null) && (
          <> Stock is what {order.branchName} holds right now, less what other approved or in-progress orders there still need.</>
        )}
      </p>
      <MaterialRequirementsTable
        lines={order.requirements}
        batchWeight={order.batchWeight}
        batchCount={order.batchCount}
        plannedQty={order.plannedQty}
        unitAbbreviation={unit}
      />
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
