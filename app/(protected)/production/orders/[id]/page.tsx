import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Pencil } from 'lucide-react'
import { getSession } from '@/lib/session'
import { trimDecimal } from '@/lib/format'
import { todayIsoDate } from '@/lib/dates'
import {
  CANCELLABLE_STATUSES,
  MAX_YIELD_FACTOR,
  ProductionOrderService,
  SHORTFALL_REQUEST_STATUSES,
} from '@/services/production-order.service'
import { StatusBadge } from '@/components/procurement/StatusBadge'
import { MaterialRequirementsTable } from '@/components/production/MaterialRequirementsTable'
import { ShortageBanner } from '@/components/production/ShortageBanner'
import { ProductionOrderActions } from '@/components/production/ProductionOrderActions'
import { ApprovalActions } from '@/components/procurement/ApprovalActions'
import { CancelProductionOrder } from '@/components/production/CancelProductionOrder'
import { CompleteProductionOrder } from '@/components/production/CompleteProductionOrder'
import { CompletionReview } from '@/components/production/CompletionReview'
import { CompletionStock } from '@/components/production/CompletionStock'
import { CostingCard } from '@/components/production/CostingCard'
import { StatusTimeline } from '@/components/production/StatusTimeline'

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
  // Task 6: production starts an approved run and may call one off before it starts.
  const canStart  = canPlan && order.status === 'APPROVED'
  const canCancel = canPlan && CANCELLABLE_STATUSES.includes(order.status)
  // Week 6 Task 1: production reports the run done with its actual yield.
  const canComplete = canPlan && order.status === 'IN_PROGRESS'
  // Week 6 Task 2: accounting signs the completion off; never whoever reported it.
  const isCompletionPending = order.status === 'PENDING_COMPLETION'
  const isOwnCompletion     = order.completedById === session.userId
  // The last change was accounting sending a reported completion back.
  const lastChange = order.statusChanges.at(-1)
  const sentBack   = lastChange?.fromStatus === 'PENDING_COMPLETION' && lastChange.toStatus === 'IN_PROGRESS'

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
          <div className="ml-auto flex items-center gap-2">
            {canCancel && <CancelProductionOrder productionOrderId={order.id} orderNumber={order.orderNumber} />}
            {canEdit && (
              <Link
                href={`/production/orders/${order.id}/edit`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-orange-200 bg-white px-3 py-1.5 text-sm font-medium text-orange-600 transition-colors hover:bg-orange-50"
              >
                <Pencil size={15} />
                Edit
              </Link>
            )}
          </div>
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

      <StatusTimeline order={order} />

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
        {/* Week 6 Task 1, D5: once the kitchen has reported it, the yield against the plan. */}
        {order.actualYield && (
          <div className="border-t border-gray-100 pt-3 sm:col-span-3">
            <Detail label="Actual yield">
              <span className="font-medium">{trimDecimal(order.actualYield.actualQty)} {unit}</span>
              <span className="text-gray-500"> of {trimDecimal(order.plannedQty)} {unit} planned</span>
              <span className={order.actualYield.difference.startsWith('-') ? 'text-amber-700' : 'text-gray-500'}>
                {' · '}{signed(order.actualYield.difference)} {unit} ({order.actualYield.percentOfPlan}%)
              </span>
            </Detail>
          </div>
        )}
      </div>

      {canEdit && (
        <ProductionOrderActions
          kind="submit"
          productionOrderId={order.id}
          shortCount={shortCount}
          ingredientCount={order.requirements.length}
          branchName={order.branchName}
          blockedReason={submitBlockedReason}
        />
      )}

      {canStart && (
        <ProductionOrderActions
          kind="start"
          productionOrderId={order.id}
          shortCount={shortCount}
          ingredientCount={order.requirements.length}
          branchName={order.branchName}
          blockedReason={null}
        />
      )}
      {canComplete && (
        <CompleteProductionOrder
          productionOrderId={order.id}
          orderNumber={order.orderNumber}
          finishedGoodName={order.finishedGoodName}
          plannedQty={order.plannedQty}
          unitAbbreviation={unit}
          maxYieldFactor={MAX_YIELD_FACTOR}
        />
      )}
      {order.status === 'IN_PROGRESS' && !canPlan && (
        <p className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          {sentBack
            ? 'Completion sent back — waiting for production to report the run again. It comes back here for approval then.'
            : 'In the kitchen. Production reports the actual yield when the run is done.'}
        </p>
      )}
      {isCompletionPending && isApprover && !isOwnCompletion && order.completionEffect && (
        <>
          <CompletionReview effect={order.completionEffect} finishedGoodName={order.finishedGoodName} costing={order.costing} />
          <ApprovalActions referenceType="ProductionCompletion" referenceId={order.id} />
        </>
      )}
      {isCompletionPending && isApprover && isOwnCompletion && (
        <p className="mb-6 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
          You reported this completion, so someone else has to approve it.
        </p>
      )}
      {order.stockMoved && <CompletionStock stock={order.stockMoved} finishedGoodName={order.finishedGoodName} />}
      {/* W6-1: nothing has moved in stock yet; accounting's sign-off does that. */}
      {isCompletionPending && !isApprover && (
        <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Completion reported — waiting for accounting to approve it. The ingredients are deducted and the
          {' '}{order.finishedGoodName} is added to stock on approval.
        </p>
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

      {/* Week 6 Task 3: what the run costs, from estimate to recorded. */}
      {order.costing && <CostingCard costing={order.costing} />}

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
          <> Stock is what {order.branchName} holds right now, less what other approved runs there still need — their ingredients leave stock when accounting approves their completion.</>
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

/** A difference with its sign spelled out: "+1.2", "−0.4" (a true minus sign), "±0". */
function signed(value: string): string {
  const trimmed = trimDecimal(value)
  if (trimmed.startsWith('-')) return `−${trimmed.slice(1)}`
  return /^0(\.0*)?$/.test(trimmed) ? '±0' : `+${trimmed}`
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-gray-800">{children}</p>
    </div>
  )
}
