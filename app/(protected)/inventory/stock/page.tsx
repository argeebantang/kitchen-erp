import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { trimDecimal } from '@/lib/format'
import { inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'
import { AutoRefresh } from '@/components/ui/AutoRefresh'
import { InventoryService, reorderAlerts } from '@/services/inventory.service'
import { PURCHASE_REQUEST_ROLES, REORDER_GENERATE_ROLES, ReorderService, type ReorderRecommendationDto } from '@/services/reorder.service'
import { shortDateLabel } from '@/lib/dates'
import { BranchRepository } from '@/repositories/branch.repository'
import { STATUS_STYLES, STOCK_STATUSES } from '@/components/inventory/StockTile'
import { StockMap } from '@/components/inventory/StockMap'
import { EmptyState } from '@/components/ui/states'
import { SearchX, Warehouse } from 'lucide-react'

const REFRESH_SECONDS = 30

type PageProps = {
  searchParams: Promise<{ branch?: string; status?: string }>
}

export default async function StockLevelsPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')

  // Plain query strings from the GET form below. The status is the lowercase
  // StockStatus (?status=low); anything else means all statuses, and a branch
  // id that matches nothing shows no branches.
  const { branch = '', status = '' } = await searchParams
  const statusFilter = STOCK_STATUSES.find(entry => entry.status.toLowerCase() === status)?.status

  // Kitchens only: outlets hold no raw materials (Week 10 Task 4).
  const [branches, branchOptions] = await Promise.all([
    InventoryService.stockMap({ branchId: branch || undefined, status: statusFilter }),
    BranchRepository.findActiveKitchens(),
  ])
  const alerts = reorderAlerts(branches)
  // Feature 4: how much to order and by when, for every alert — the table and each tile's popup.
  const reorder = {
    recommendations: await ReorderService.forAlerts(alerts),
    canExplain:      REORDER_GENERATE_ROLES.includes(session.role),
    canRequest:      PURCHASE_REQUEST_ROLES.includes(session.role),
  }
  const filtered = Boolean(branch || statusFilter)
  const renderedAt = new Date().toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', timeStyle: 'medium' })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Stock Levels</h1>
        <p className="mt-1 text-sm text-gray-400">
          Every active material at every kitchen, against its reorder point — outlets hold none. Click a 🔴 or 🟡 tile
          for how much to reorder and by when. Updated {renderedAt}; refreshes every {REFRESH_SECONDS} seconds while this
          tab is open.
        </p>
      </div>
      <AutoRefresh seconds={REFRESH_SECONDS} />

      {/* A GET form, like the ledger's: the filters live in the URL, so a view can be bookmarked. */}
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="block min-w-48">
          <span className="mb-1 block text-xs font-medium text-gray-500">Kitchen</span>
          <select name="branch" defaultValue={branch} className={inputClass}>
            <option value="">All kitchens</option>
            {branchOptions.map(option => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
        </label>
        <label className="block min-w-48">
          <span className="mb-1 block text-xs font-medium text-gray-500">Status</span>
          <select name="status" defaultValue={statusFilter?.toLowerCase() ?? ''} className={inputClass}>
            <option value="">All statuses</option>
            {STOCK_STATUSES.map(option => (
              <option key={option.status} value={option.status.toLowerCase()}>{option.label}</option>
            ))}
          </select>
        </label>
        <button type="submit" className={primaryButtonClass}>Apply</button>
        {filtered && (
          <Link href="/inventory/stock" className={secondaryButtonClass}>Clear</Link>
        )}
      </form>

      <dl className="mb-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {STOCK_STATUSES.map(({ status, label, meaning }) => (
          <div key={status} className="flex gap-1.5">
            <dt className="font-medium text-gray-700">{label}</dt>
            <dd className="text-gray-400">— {meaning}</dd>
          </div>
        ))}
      </dl>

      {alerts.length > 0 && (
        // <details> so the list can be folded away without any client JS.
        <details open className="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
          <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-gray-800">
            Reorder alerts · {alerts.length}
          </summary>
          <table className="w-full text-sm">
            <thead className="border-y border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Material</th>
                <th className="px-4 py-3 font-medium">Branch</th>
                <th className="px-4 py-3 text-right font-medium">On hand</th>
                <th className="px-4 py-3 text-right font-medium">Reorder point</th>
                <th className="px-4 py-3 text-right font-medium">Short by</th>
                <th className="px-4 py-3 text-right font-medium">Recommended order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {alerts.map(alert => (
                <tr key={`${alert.branchId}:${alert.materialId}`}>
                  <td className="px-4 py-3">
                    <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[alert.status].badgeClass}`}>
                      {STATUS_STYLES[alert.status].label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-gray-700">{alert.materialName}</p>
                    <p className="font-mono text-xs text-gray-400">{alert.materialCode}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{alert.branchName}</td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {trimDecimal(alert.quantity)} <span className="text-gray-400">{alert.unitAbbreviation}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">
                    {trimDecimal(alert.reorderPoint)} <span className="text-gray-400">{alert.unitAbbreviation}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-800">
                    {alert.shortfall === null ? '—' : trimDecimal(alert.shortfall)}{' '}
                    <span className="font-normal text-gray-400">{alert.unitAbbreviation}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <RecommendedOrder rec={reorder.recommendations[`${alert.branchId}:${alert.materialId}`]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {branches.length === 0 ? (
        filtered ? (
          <EmptyState icon={SearchX} title="No kitchen matches these filters" action={{ href: '/inventory/stock', label: 'Clear filters' }} />
        ) : (
          <EmptyState icon={Warehouse} title="No active kitchens">
            An admin sets up kitchens in Master Data → Branches.
          </EmptyState>
        )
      ) : (
        <StockMap branches={branches} reorder={reorder} />
      )}
    </div>
  )
}

/** The alerts table's summary of a tile's recommendation; the popup has the workings. */
function RecommendedOrder({ rec }: { rec: ReorderRecommendationDto | undefined }) {
  if (!rec) return <span className="text-gray-400">—</span>
  if (!rec.orderNeeded) return <span className="text-emerald-700">Covered by what is on order</span>
  return (
    <span className="text-gray-800">
      <span className="font-medium">{trimDecimal(rec.recommendedQty)} {rec.unit}</span>
      <span className="text-gray-500"> by {rec.orderBy === rec.today ? 'today' : shortDateLabel(rec.orderBy)}</span>
      {rec.lateByDays > 0 && <span className="block text-xs text-red-700">{rec.lateByDays} {rec.lateByDays === 1 ? 'day' : 'days'} late even today</span>}
    </span>
  )
}
