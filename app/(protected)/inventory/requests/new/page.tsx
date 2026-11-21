import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { StockRequestService, MAX_REQUEST_LINES } from '@/services/stock-request.service'
import { StockRequestForm } from '@/components/inventory/StockRequestForm'

type PageProps = {
  // searchParams is a Promise in Next.js 15. ?from= preselects the outlet (from its Branch Inventory).
  searchParams: Promise<{ from?: string }>
}

/**
 * New stock request (Week 9 Task 10). ADMIN + BRANCH_MANAGER (middleware); a
 * branch manager asks for the outlet they run.
 */
export default async function NewStockRequestPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  const [{ from }, form] = await Promise.all([
    searchParams,
    StockRequestService.getForm({ userId: session.userId, role: session.role }),
  ])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">New stock request</h1>
        <p className="mt-1 text-sm text-gray-400">
          Ask a central kitchen for finished goods by a day. The kitchen plans it — or tells you what it can&apos;t send and why —
          then sends the delivery.
        </p>
      </div>
      <StockRequestForm {...form} maxLines={MAX_REQUEST_LINES} initialBranchId={from} />
    </div>
  )
}
