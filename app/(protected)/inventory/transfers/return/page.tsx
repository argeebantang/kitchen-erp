import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { StockTransferService, MAX_TRANSFER_LINES } from '@/services/stock-transfer.service'
import { TransferOrderForm } from '@/components/inventory/TransferOrderForm'

type PageProps = {
  // searchParams is a Promise in Next.js 15. ?from= preselects the outlet (from its Branch Inventory).
  searchParams: Promise<{ from?: string }>
}

/**
 * Return unsold goods to a kitchen (Week 9 Task 9). ADMIN + BRANCH_MANAGER
 * (middleware); a branch manager can only send from the outlet they run.
 * No approval: the lots leave the outlet when it is sent.
 */
export default async function ReturnToKitchenPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  const { from } = await searchParams

  const form = await StockTransferService.getReturnForm({ userId: session.userId, role: session.role })
  const outlet = form.fromBranches.find(branch => branch.id === from) ?? form.fromBranches[0]

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Return to a kitchen</h1>
        <p className="mt-1 text-sm text-gray-400">
          Unsold finished goods going back to a central kitchen, where they can be converted. They leave the outlet as soon as
          you send — the kitchen counts what arrives.
        </p>
      </div>
      <TransferOrderForm
        {...form}
        mode="return"
        maxLines={MAX_TRANSFER_LINES}
        initialFromBranchId={outlet?.id}
        cancelHref="/inventory/branches"
      />
    </div>
  )
}
