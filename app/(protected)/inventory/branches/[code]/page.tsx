import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, PackageOpen } from 'lucide-react'
import { getSession } from '@/lib/session'
import { formatDateTime } from '@/lib/dates'
import { formatPeso, trimDecimal } from '@/lib/format'
import { BranchInventoryService } from '@/services/branch-inventory.service'
import { FINISHED_GOOD_LOT_LIMIT, reorderAlerts } from '@/services/inventory.service'
import { PURCHASE_REQUEST_ROLES, REORDER_GENERATE_ROLES, ReorderService } from '@/services/reorder.service'
import { BranchHeadline } from '@/components/inventory/BranchHeadline'
import { BranchTransfers } from '@/components/inventory/BranchTransfers'
import { StockMap } from '@/components/inventory/StockMap'
import { LiveRefresh } from '@/components/ui/LiveRefresh'
import { ExpiryBadge, expiryRowClass } from '@/components/inventory/ExpiryBadge'
import { EmptyState } from '@/components/ui/states'

type PageProps = {
  params: Promise<{ code: string }>
}

/**
 * One branch's inventory (Week 8 Task 5, I2): its figures at a glance, then
 * its finished goods by good, each good's lots soonest to expire first — use
 * them in that order. "Not found" for an unknown or inactive branch, and for
 * a branch manager opening a branch that is not theirs (I4, I8).
 */
export default async function BranchInventoryPage({ params }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  const { code } = await params

  const inventory = await BranchInventoryService.forBranch(code, { userId: session.userId, role: session.role })
  if (!inventory) notFound()
  const { branch, headline, goods, truncated, materials, transfers } = inventory
  const reorder = {
    recommendations: materials ? await ReorderService.forAlerts(reorderAlerts([materials])) : {},
    canExplain:      REORDER_GENERATE_ROLES.includes(session.role),
    canRequest:      PURCHASE_REQUEST_ROLES.includes(session.role),
  }
  // A branch manager sees only their own branch, so the index would bring them straight back here.
  const showBack = session.role !== 'BRANCH_MANAGER'
  const renderedAt = new Date().toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', timeStyle: 'medium' })
  // The full pages, filtered to this branch (I2). Transfers only for roles that can open it (SOURCE_PAGES).
  const links = [
    { label: 'Finished Goods', href: `/inventory/finished-goods?branch=${branch.id}` },
    { label: 'End of Day',     href: `/inventory/end-of-day?branch=${branch.id}` },
    // Raw-material pages: only a kitchen holds any (Week 10 Task 4).
    ...(materials ? [
      { label: 'Stock Levels', href: `/inventory/stock?branch=${branch.id}` },
      { label: 'Stock Ledger', href: `/inventory/ledger?branch=${branch.id}` },
    ] : []),
    ...(transfers.canOpen ? [{ label: 'Transfers', href: `/inventory/transfers?branch=${branch.id}` }] : []),
  ]

  return (
    <div>
      {showBack && (
        <Link
          href="/inventory/branches"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
        >
          <ArrowLeft size={15} />
          Branch Inventory
        </Link>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">
          {branch.name} <span className="font-mono text-base font-normal text-gray-400">{branch.code}</span>
        </h1>
        <p className="mt-1 text-sm text-gray-400">
          {branch.typeLabel} · {branch.managerName ? `managed by ${branch.managerName}` : 'no manager'} · updated {renderedAt} ·{' '}
          <LiveRefresh branchId={branch.id} />
        </p>
        <nav className="mt-3 flex flex-wrap gap-2">
          {links.map(link => (
            <Link
              key={link.label}
              href={link.href}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-800"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="mb-8">
        <BranchHeadline headline={headline} />
      </div>

      <BranchTransfers branch={branch} transfers={transfers} />

      <section>
        <h2 className="mb-1 text-lg font-semibold text-gray-800">Finished goods</h2>
        <p className="mb-3 text-sm text-gray-400">Each good&apos;s lots, soonest to expire first — use them in this order.</p>

        {truncated && (
          <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Showing {FINISHED_GOOD_LOT_LIMIT} lots; the figures above cover the lots shown.
          </p>
        )}

        {goods.length === 0 ? (
          <EmptyState icon={PackageOpen} title={`No finished goods on hand at ${branch.name}`}>
            Lots arrive here when accounting approves a production run or conversion made here, or when a transfer to this
            branch is received.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Good / lot</th>
                  <th className="px-4 py-3 text-right font-medium">On hand</th>
                  <th className="px-4 py-3 text-right font-medium">Value at cost</th>
                  <th className="px-4 py-3 font-medium">Produced on</th>
                  <th className="px-4 py-3 font-medium">Expires</th>
                </tr>
              </thead>
              {goods.map(good => (
                <tbody key={good.finishedGoodId} className="divide-y divide-gray-100 border-b border-gray-200 last:border-b-0">
                  <tr className="bg-gray-50/70">
                    <td className="px-4 py-2.5 font-semibold text-gray-800">
                      {good.finishedGoodName} <span className="font-mono text-xs font-normal text-gray-400">{good.finishedGoodCode}</span>
                      <span className="ml-2 text-xs font-normal text-gray-400">{good.lots.length} {good.lots.length === 1 ? 'lot' : 'lots'}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-gray-800">
                      {trimDecimal(good.quantity)} <span className="font-normal text-gray-400">{good.unitAbbreviation}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-gray-800">
                      {good.value === null ? <span className="font-normal text-gray-400">—</span> : formatPeso(good.value)}
                    </td>
                    <td colSpan={2} />
                  </tr>
                  {good.lots.map(lot => (
                    <tr key={lot.lotId} className={`transition-colors ${expiryRowClass(lot.expiry)}`}>
                      <td className="py-2 pl-8 pr-4">
                        {/* The lot number is its order's or conversion's; it links there for roles that can open it. */}
                        {lot.source?.href ? (
                          <Link href={lot.source.href} className="font-mono text-xs text-orange-600 hover:text-orange-700 hover:underline">
                            {lot.lotNumber}
                          </Link>
                        ) : (
                          <span className="font-mono text-xs text-gray-700">{lot.lotNumber}</span>
                        )}
                      </td>
                      <td className={`px-4 py-2 text-right tabular-nums ${lot.quantity.startsWith('-') ? 'font-medium text-red-700' : 'text-gray-800'}`}>
                        {trimDecimal(lot.quantity)} <span className="text-gray-400">{lot.unitAbbreviation}</span>
                        {lot.pendingWriteOff && (
                          <span className="block text-xs text-amber-700">
                            {trimDecimal(lot.pendingWriteOff.quantity)} {lot.unitAbbreviation} pending write-off
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                        {lot.value === null ? <span className="text-gray-400">—</span> : formatPeso(lot.value)}
                      </td>
                      <td className="px-4 py-2 text-gray-500">{lot.producedOn}</td>
                      <td className="px-4 py-2">
                        {lot.expiresAt === null ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className={lot.expired ? 'font-medium text-red-700' : 'text-gray-700'}>{formatDateTime(lot.expiresAt)}</span>
                            <ExpiryBadge flag={lot.expiry} />
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </section>

      {/* Only a kitchen holds raw materials (Week 10 Task 4); an outlet's headline says so. */}
      {materials && (
        <section className="mt-8">
          <h2 className="mb-1 text-lg font-semibold text-gray-800">Raw materials</h2>
          <p className="mb-3 text-sm text-gray-400">
            Against each material&apos;s reorder point, as on Stock Levels. Click a tile for its details — a 🔴 or 🟡 one
            shows how much to reorder and by when.
          </p>
          <StockMap branches={[materials]} reorder={reorder} />
        </section>
      )}
    </div>
  )
}
