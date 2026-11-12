import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { getSession } from '@/lib/session'
import { formatDateTime } from '@/lib/dates'
import { formatPeso, trimDecimal } from '@/lib/format'
import { inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'
import { FINISHED_GOOD_LOT_LIMIT, InventoryService } from '@/services/inventory.service'
import { BranchRepository } from '@/repositories/branch.repository'

type PageProps = {
  searchParams: Promise<{ branch?: string }>
}

/**
 * Finished goods on hand (Week 6 Task 2, D10): what completed production runs
 * and approved conversions (Week 7 Task 1) put into stock, lot by lot. Every
 * signed-in role, like Stock Levels. A lot appears once accounting approves
 * its run's completion or its conversion.
 */
export default async function FinishedGoodsPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')

  // A plain query string from the GET form; an unknown branch id matches nothing.
  const { branch = '' } = await searchParams

  // Week 7 Task 2, W7: the roles that record write-offs get a Write off action per lot.
  const canWriteOff = session.role === 'ADMIN' || session.role === 'PRODUCTION_MANAGER'

  const [{ lots, totals, truncated }, branchOptions] = await Promise.all([
    InventoryService.finishedGoodStock({ branchId: branch || undefined }, { role: session.role }),
    BranchRepository.findAllActive(),
  ])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Finished Goods</h1>
        <p className="mt-1 text-sm text-gray-400">
          Cooked goods on hand, by lot, soonest to expire first — use them in this order. A lot is the output of
          one production run (PRD-…) or one conversion (CNV-…), numbered after it; it is added here when accounting
          approves it, and expires its finished good&apos;s shelf life after it was cooked.
        </p>
      </div>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="block min-w-48">
          <span className="mb-1 block text-xs font-medium text-gray-500">Branch</span>
          <select name="branch" defaultValue={branch} className={inputClass}>
            <option value="">All branches</option>
            {branchOptions.map(option => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
        </label>
        <button type="submit" className={primaryButtonClass}>Apply</button>
        {branch && <Link href="/inventory/finished-goods" className={secondaryButtonClass}>Clear</Link>}
      </form>

      {lots.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-gray-600">No finished goods on hand</p>
          <p className="mt-1 text-sm text-gray-400">
            Complete a production run or record a conversion, and have accounting approve it — its output appears here as a lot.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap gap-3">
            {totals.map(total => (
              <div key={`${total.finishedGoodId}:${total.branchName}`} className="min-w-48 rounded-xl border border-gray-200 bg-white px-4 py-3">
                <p className="text-sm font-medium text-gray-800">{total.finishedGoodName}</p>
                <p className="mt-1 text-xl font-semibold text-gray-900">
                  {trimDecimal(total.quantity)} <span className="text-sm font-normal text-gray-500">{total.unitAbbreviation}</span>
                </p>
                <p className="text-xs text-gray-400">
                  {total.branchName} · {total.lotCount} {total.lotCount === 1 ? 'lot' : 'lots'}
                  {/* At each lot's cost per unit, recorded when its run was approved (Week 6 Task 3). */}
                  {total.value !== null && <> · worth {formatPeso(total.value)}</>}
                </p>
              </div>
            ))}
          </div>

          {truncated && (
            <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Showing the newest {FINISHED_GOOD_LOT_LIMIT} lots; filter by branch to narrow it down. The totals above
              cover the lots shown.
            </p>
          )}

          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Lot</th>
                  <th className="px-4 py-3 font-medium">Finished good</th>
                  <th className="px-4 py-3 font-medium">Branch</th>
                  <th className="px-4 py-3 text-right font-medium">On hand</th>
                  <th className="px-4 py-3 text-right font-medium">Unit cost</th>
                  <th className="px-4 py-3 text-right font-medium">Value</th>
                  <th className="px-4 py-3 font-medium">Produced on</th>
                  <th className="px-4 py-3 font-medium">Expires</th>
                  <th className="px-4 py-3 font-medium">Last movement</th>
                  {canWriteOff && <th className="px-4 py-3"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lots.map(lot => (
                  <tr
                    key={`${lot.lotNumber}:${lot.branchId}`}
                    className={`transition-colors ${lot.expired ? 'bg-red-50/60 hover:bg-red-50' : 'hover:bg-gray-50'}`}
                  >
                    <td className="px-4 py-3">
                      {/* The lot number is its order's or conversion's; it links there for roles that can open it. */}
                      {lot.source?.href ? (
                        <Link href={lot.source.href} className="font-mono text-xs text-orange-600 hover:text-orange-700 hover:underline">
                          {lot.lotNumber}
                        </Link>
                      ) : (
                        <span className="font-mono text-xs text-gray-700">{lot.lotNumber}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {lot.finishedGoodName} <span className="font-mono text-xs text-gray-400">{lot.finishedGoodCode}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{lot.branchName}</td>
                    <td className={`px-4 py-3 text-right font-medium ${lot.quantity.startsWith('-') ? 'text-red-700' : 'text-gray-800'}`}>
                      {trimDecimal(lot.quantity)} <span className="font-normal text-gray-400">{lot.unitAbbreviation}</span>
                      {/* Week 7 Task 2: still on hand, but a write-off awaiting approval claims it. */}
                      {lot.pendingWriteOff && (
                        <span className="block text-xs font-normal">
                          {lot.pendingWriteOff.href ? (
                            <Link href={lot.pendingWriteOff.href} className="text-amber-700 hover:underline">
                              {trimDecimal(lot.pendingWriteOff.quantity)} {lot.unitAbbreviation} pending write-off
                            </Link>
                          ) : (
                            <span className="text-amber-700">{trimDecimal(lot.pendingWriteOff.quantity)} {lot.unitAbbreviation} pending write-off</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {lot.unitCost === null
                        ? <span className="text-gray-400">—</span>
                        : <>{formatPeso(lot.unitCost)}<span className="text-gray-400">/{lot.unitAbbreviation}</span></>}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {lot.value === null ? <span className="text-gray-400">—</span> : formatPeso(lot.value)}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{lot.producedOn}</td>
                    <td className="px-4 py-3">
                      {/* 24 / 48-hour warnings before this are Week 7's. */}
                      {lot.expiresAt === null ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className={lot.expired ? 'font-medium text-red-700' : 'text-gray-700'}>{formatDateTime(lot.expiresAt)}</span>
                          {lot.expired && (
                            <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">Expired</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{formatDateTime(lot.lastMovementAt)}</td>
                    {canWriteOff && (
                      <td className="px-4 py-3 text-right">
                        {/* Only something on hand can be written off; the form is pre-filled from the lot. */}
                        {!lot.quantity.startsWith('-') && !/^0(\.0*)?$/.test(lot.quantity) && (
                          <Link
                            href={`/inventory/write-offs/new?lot=${lot.lotId}&branch=${lot.branchId}`}
                            className={`inline-flex items-center gap-1 whitespace-nowrap rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                              lot.expired
                                ? 'border-red-200 bg-white text-red-700 hover:bg-red-50'
                                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                            }`}
                          >
                            <Trash2 size={13} />
                            Write off
                          </Link>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
