import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { todayIsoDate } from '@/lib/dates'
import { getSession } from '@/lib/session'
import { trimDecimal } from '@/lib/format'
import { MAX_BATCH_COUNT, ProductionOrderService } from '@/services/production-order.service'
import { ProductionOrderForm } from '@/components/production/ProductionOrderForm'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function EditProductionOrderPage({ params }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  // Middleware keeps /production to ADMIN + PRODUCTION_MANAGER today, but Task 5
  // lets accounting read production orders, and a prefix cannot single out
  // [id]/edit — so the page checks. PATCH is guarded in middleware regardless.
  if (session.role !== 'PRODUCTION_MANAGER' && session.role !== 'ADMIN') redirect('/unauthorized')

  const { id } = await params

  const [result, { goods, branches: activeBranches }] = await Promise.all([
    ProductionOrderService.getById(id),
    ProductionOrderService.getForm(),
  ])
  if (!result.success) notFound()
  const order = result.data
  const today = todayIsoDate()

  // A good whose BOM was retired since the draft was saved is no longer in the
  // picker; say so rather than leave the select silently blank.
  const goodStillPlannable = goods.some(good => good.finishedGoodId === order.finishedGoodId)

  // The branch may have been deactivated since; it stays selectable so opening
  // the edit page does not silently change it (the service refuses it on save).
  const branches = activeBranches.some(branch => branch.id === order.branchId)
    ? activeBranches
    : [{ id: order.branchId, name: order.branchName }, ...activeBranches]

  return (
    <div>
      <Link
        href={`/production/orders/${order.id}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
      >
        <ArrowLeft size={15} />
        {order.orderNumber}
      </Link>

      <h1 className="text-2xl font-bold text-gray-800">Edit {order.orderNumber}</h1>
      <p className="mb-6 mt-1 text-sm text-gray-400">
        Saving switches the order to the finished good&apos;s active BOM version.
        Requested by {order.requestedByName}; that does not change.
      </p>

      {order.status !== 'DRAFT' ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-gray-600">This order can no longer be edited</p>
          <p className="mt-1 text-sm text-gray-400">Only a draft can be changed.</p>
        </div>
      ) : (
        <>
          {!goodStillPlannable && (
            <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {order.finishedGoodName} can no longer be planned — it has no active BOM, or it was deactivated.
              Choose another finished good, or create a BOM for it first.
            </p>
          )}
          <ProductionOrderForm
            productionOrderId={order.id}
            goods={goods}
            branches={branches}
            today={today}
            maxBatchCount={MAX_BATCH_COUNT}
            initial={{
              finishedGoodId: goodStillPlannable ? order.finishedGoodId : '',
              batchWeight:    trimDecimal(order.batchWeight),
              batchCount:     String(order.batchCount),
              plannedDate:    order.plannedDate,
              branchId:       order.branchId,
              notes:          order.notes ?? '',
            }}
          />
        </>
      )}
    </div>
  )
}
