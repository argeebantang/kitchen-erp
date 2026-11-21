import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { StockTransferService, MAX_TRANSFER_LINES } from '@/services/stock-transfer.service'
import { StockRequestService } from '@/services/stock-request.service'
import { TransferOrderForm } from '@/components/inventory/TransferOrderForm'

type PageProps = {
  // ?request= (Week 9 Task 10): send a planned stock request — its kitchen, outlet and planned lines.
  searchParams: Promise<{ request?: string }>
}

/**
 * New Transfer Order (Week 8 Task 2). ADMIN + PRODUCTION_MANAGER
 * (middleware): the kitchen chooses what to send where — or sends what a
 * stock request planned, linked to it.
 */
export default async function NewTransferPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  const [form, { request }] = await Promise.all([StockTransferService.getForm(), searchParams])
  const plan = request ? await StockRequestService.sendPlan(request, { userId: session.userId, role: session.role }) : null

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">{plan ? `Send ${plan.requestNumber}` : 'New transfer'}</h1>
        <p className="mt-1 text-sm text-gray-400">
          {plan
            ? 'The delivery for this stock request, filled in from what the kitchen planned — change a line if you send something else. Accounting approves it before anything leaves.'
            : 'Finished goods to send from a commissary to a branch. Accounting approves it before anything leaves.'}
        </p>
        {request && !plan && (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            That stock request can&apos;t be sent from here — it is not planned, or a delivery is already on its way. This is a plain transfer.
          </p>
        )}
      </div>
      <TransferOrderForm
        {...form}
        maxLines={MAX_TRANSFER_LINES}
        initialFromBranchId={plan?.fromBranchId}
        initialToBranchId={plan?.toBranchId}
        initialLines={plan?.lines}
        stockRequest={plan ? { id: plan.requestId, requestNumber: plan.requestNumber } : undefined}
        cancelHref={plan ? `/inventory/requests/${plan.requestId}` : undefined}
      />
    </div>
  )
}
