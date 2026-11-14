import { StockTransferService, MAX_TRANSFER_LINES } from '@/services/stock-transfer.service'
import { TransferOrderForm } from '@/components/inventory/TransferOrderForm'

/**
 * New Transfer Order (Week 8 Task 2). ADMIN + PRODUCTION_MANAGER
 * (middleware): the kitchen chooses what to send where.
 */
export default async function NewTransferPage() {
  const form = await StockTransferService.getForm()

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">New transfer</h1>
        <p className="mt-1 text-sm text-gray-400">
          Finished goods to send from a commissary to a branch. Accounting approves it before anything leaves.
        </p>
      </div>
      <TransferOrderForm {...form} maxLines={MAX_TRANSFER_LINES} />
    </div>
  )
}
