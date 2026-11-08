import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Pencil } from 'lucide-react'
import { getSession } from '@/lib/session'
import { trimDecimal } from '@/lib/format'
import { todayIsoDate } from '@/lib/dates'
import { ProductionOrderService, SHORTFALL_REQUEST_STATUSES } from '@/services/production-order.service'
import { StatusBadge } from '@/components/procurement/StatusBadge'
import { MaterialRequirementsTable } from '@/components/production/MaterialRequirementsTable'
import { ShortageBanner } from '@/components/production/ShortageBanner'
import { ProductionOrderActions } from '@/components/production/ProductionOrderActions'
import { ApprovalActions } from '@/components/procurement/ApprovalActions'
import { DecisionHistory } from '@/components/procurement/DecisionHistory'

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
  // Same roles ProductionOrderService.update and submit accept. Accounting
  // reads this page too (Task 5) but only decides.
  const canPlan = session.role === 'PRODUCTION_MANAGER' || session.role === 'ADMIN'
  const canEdit = isDraft && canPlan
  // The roles middleware lets onto /api/approvals. Nobody decides an order
  // they submitted, ADMIN included — the service refuses it too.
  const isPending      = order.status === 'PENDING_APPROVAL'
  const isApprover     = session.role === 'ACCOUNTING' || session.role === 'ADMIN'
  const isOwnSubmission = order.submittedById === session.userId
  const shortCount     = order.requirements.filter(line => line.stock !== null && !line.stock.enough).length
  // What ProductionOrderService.submit would refuse, said before the click.
  const submitBlockedReason = !order.bomIsActive
    ? `BOM v${order.bomVersion} has been replaced. Open Edit and save to switch to the current version, then submit.`
    : order.plannedDate < todayIsoDate()
      ? 'The production date has passed. Open Edit and choose today or later, then submit.'
      : null
  // Task 4, D4: the roles that plan production (and may raise a purchase
  // request), while ordering can still arrive in time.
  const canRequestShortfall = canPlan && SHORTFALL_REQUEST_STATUSES.includes(order.status)

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
        <Detail label="Submitted by">{order.submittedByName ?? <span className="text-gray-400">Not yet</span>}</Detail>
        <Detail label="Created · last saved">
          {order.createdAt.slice(0, 10)} <span className="text-gray-400">· {order.updatedAt.slice(0, 10)}</span>
        </Detail>
      </div>

      {canEdit && (
        <ProductionOrderActions
          productionOrderId={order.id}
          shortCount={shortCount}
          ingredientCount={order.requirements.length}
          branchName={order.branchName}
          blockedReason={submitBlockedReason}
        />
      )}

      {isPending && isApprover && !isOwnSubmission && (
        <ApprovalActions referenceType="ProductionOrder" referenceId={order.id} />
      )}
      {isPending && isApprover && isOwnSubmission && (
        <p className="mb-6 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
          You submitted this order, so someone else has to decide it.
        </p>
      )}
      {isPending && !isApprover && (
        <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Submitted — waiting for accounting&apos;s decision.
        </p>
      )}

      <DecisionHistory decisions={order.decisions} />

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
      <ShortageBanner
        lines={order.requirements}
        branchName={order.branchName}
        requestHref={canRequestShortfall ? `/procurement/requests/new?productionOrder=${order.id}` : undefined}
      />
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
