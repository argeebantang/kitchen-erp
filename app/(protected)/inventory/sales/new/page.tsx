import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { OutletSaleService } from '@/services/outlet-sale.service'
import { OutletSaleForm } from '@/components/inventory/OutletSaleForm'

type PageProps = {
  // ?branch= preselects the outlet (from its Branch Inventory page).
  searchParams: Promise<{ branch?: string }>
}

/**
 * Record a day's sales (Week 10 Task 1). ADMIN + BRANCH_MANAGER (middleware);
 * a branch manager records for the outlet they run.
 */
export default async function NewOutletSalePage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  const { branch } = await searchParams
  const form = await OutletSaleService.getForm({ userId: session.userId, role: session.role })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Record the day&apos;s sales</h1>
        <p className="mt-1 text-sm text-gray-400">
          At closing: how much of each finished good the outlet sold. The goods leave the outlet&apos;s stock, oldest lots first.
        </p>
      </div>
      <OutletSaleForm {...form} initialBranchId={branch} />
    </div>
  )
}
