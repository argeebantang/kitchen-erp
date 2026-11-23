import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { formatPeso } from '@/lib/format'
import { BranchInventoryService } from '@/services/branch-inventory.service'
import { BranchHeadline } from '@/components/inventory/BranchHeadline'
import { LiveRefresh } from '@/components/ui/LiveRefresh'
import { EmptyState } from '@/components/ui/states'
import { Store } from 'lucide-react'

/**
 * Branch Inventory (Week 8 Task 5, I1): a card per active branch, each opening
 * that branch's own page. A branch manager goes straight to the branch they
 * manage (I4).
 */
export default async function BranchInventoryIndexPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const overview = await BranchInventoryService.overview({ userId: session.userId, role: session.role })
  if (overview.kind === 'own') redirect(`/inventory/branches/${overview.code}`)
  const renderedAt = new Date().toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', timeStyle: 'medium' })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Branch Inventory</h1>
        <p className="mt-1 text-sm text-gray-400">
          Each branch&apos;s stock on its own page — finished goods, what expires first, raw materials and what is on its way.
          {overview.kind === 'all' && (
            <>
              {' '}Updated {renderedAt} · <LiveRefresh branchId={null} />
            </>
          )}
        </p>
      </div>

      {overview.kind === 'none' ? (
        <EmptyState icon={Store} title="You don't manage a branch yet">
          An admin assigns branch managers in Master Data → Branches.
        </EmptyState>
      ) : (
        <>
          {overview.truncated && (
            <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              There are more finished-goods lots than these cards count at once; open a branch for its full figures.
            </p>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            {overview.cards.map(({ branch, headline }) => (
              <Link
                key={branch.id}
                href={`/inventory/branches/${branch.code}`}
                className="block rounded-xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
              >
                <div className="mb-4 flex items-baseline justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-gray-800">
                      {branch.name} <span className="font-mono text-xs font-normal text-gray-400">{branch.code}</span>
                    </p>
                    <p className="text-xs text-gray-400">
                      {branch.typeLabel} · {branch.managerName ? `managed by ${branch.managerName}` : 'no manager'}
                    </p>
                  </div>
                  <p className="text-right text-sm text-gray-500">
                    {headline.finishedGoods.value === null ? '—' : formatPeso(headline.finishedGoods.value)}
                    <span className="block text-xs text-gray-400">finished goods at cost</span>
                  </p>
                </div>
                <BranchHeadline headline={headline} compact />
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
