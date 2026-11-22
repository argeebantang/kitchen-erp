import Link from 'next/link'
import { shortDateLabel } from '@/lib/dates'
import { trimDecimal } from '@/lib/format'
// Type-only: worked out on the server, passed down with the stock map.
import type { ReorderRecommendationDto } from '@/services/reorder.service'
import { AiInsightPanel } from '@/components/ai/AiInsightPanel'
import { AutoRefresh } from '@/components/ui/AutoRefresh'
import { primaryButtonClass } from '@/components/ui/form'

/** While an explanation is being written, the popup refreshes this often to show it. */
const WRITING_REFRESH_SECONDS = 4

const LEAD_TIME_SOURCES = {
  measured: (rec: ReorderRecommendationDto) => `measured over ${rec.leadTime.measuredOrders} orders`,
  promised: () => 'promised by the supplier',
  default:  () => 'default — nothing measured or promised',
} as const

export type ReorderPermissions = {
  /** May ask KitchenAI to explain it, or regenerate. */
  canExplain: boolean
  /** May open the pre-filled purchase request. */
  canRequest: boolean
}

/**
 * FEATURE 4 — the Reorder Recommender inside a 🔴/🟡 tile's popup (Week 10
 * Task 4): the order and its deadline as the code worked them out, the steps
 * behind them, KitchenAI's explanation, and the button that opens the
 * purchase request pre-filled with it.
 */
export function ReorderPanel({ rec, canExplain, canRequest }: { rec: ReorderRecommendationDto } & ReorderPermissions) {
  const unit = rec.unit
  const amount = (value: string) => `${trimDecimal(value)} ${unit}`
  const writing = rec.insight?.status === 'PENDING'

  return (
    <div className="mt-5 border-t border-gray-100 pt-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Reorder recommendation</p>

      {rec.orderNeeded ? (
        <p className="mt-1 text-base font-semibold text-gray-900">
          Order {amount(rec.recommendedQty)} by {shortDateLabel(rec.orderBy)}
          {rec.orderBy === rec.today && <span className="font-normal text-gray-500"> (today)</span>}
        </p>
      ) : (
        <p className="mt-1 text-base font-semibold text-emerald-700">No order needed — on hand and on order cover the next {rec.horizonDays} days</p>
      )}
      <p className="text-sm text-gray-600">
        {rec.runOutDate === null
          ? `Not expected to run out within ${rec.horizonDays} days.`
          : rec.runOutDate === rec.today && Number(rec.onHand) <= 0
            ? 'Out of stock now.'
            : `Expected to run short on ${shortDateLabel(rec.runOutDate)}.`}
      </p>
      {rec.orderNeeded && rec.lateByDays > 0 && (
        <p className="mt-1 rounded bg-red-50 px-2 py-1 text-sm text-red-700">
          Even ordered today, it arrives {rec.lateByDays} {rec.lateByDays === 1 ? 'day' : 'days'} after it runs short — order now and
          plan around the gap.
        </p>
      )}

      <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-gray-500">Daily use</dt>
        <dd className="text-right text-gray-700">{amount(rec.dailyUse)} <span className="text-xs text-gray-400">({amount(rec.usedInPeriod)} in {rec.usageDays} days)</span></dd>

        <dt className="text-gray-500">Supplier</dt>
        <dd className="text-right text-gray-700">{rec.supplier?.name ?? 'None on record'}</dd>

        <dt className="text-gray-500">Lead time</dt>
        <dd className="text-right text-gray-700">
          {rec.leadTime.days} {rec.leadTime.days === 1 ? 'day' : 'days'} <span className="text-xs text-gray-400">({LEAD_TIME_SOURCES[rec.leadTime.source](rec)})</span>
        </dd>

        <dt className="text-gray-500">Expected use, next {rec.horizonDays} days</dt>
        <dd className="text-right text-gray-700">
          {amount(rec.expectedUse)}{' '}
          <span className="text-xs text-gray-400">
            ({rec.leadTime.days} lead + {rec.coverDays} cover{rec.scheduleDays > 0 && `; scheduled runs on ${rec.scheduleDays} ${rec.scheduleDays === 1 ? 'day' : 'days'}`})
          </span>
        </dd>

        <dt className="text-gray-500">+ Safety stock (reorder point)</dt>
        <dd className="text-right text-gray-700">{amount(rec.reorderPoint)}</dd>

        <dt className="text-gray-500">− On hand</dt>
        <dd className="text-right text-gray-700">{amount(rec.onHand)}</dd>

        <dt className="text-gray-500">− On order for this kitchen</dt>
        <dd className="text-right text-gray-700">{amount(rec.onOrderTotal)}</dd>

        <dt className="font-medium text-gray-700">= Order, rounded up</dt>
        <dd className="text-right font-semibold text-gray-900">{rec.orderNeeded ? amount(rec.recommendedQty) : 'nothing'}</dd>
      </dl>

      {rec.supplierLastMonth && rec.supplierLastMonth.flagReasons.length > 0 && (
        <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
          {rec.supplier?.name} was flagged in the supplier review: {rec.supplierLastMonth.flagReasons.join('; ')}.
        </p>
      )}

      {rec.scheduled.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-gray-500">Scheduled runs that use it</p>
          <ul className="mt-0.5 space-y-0.5 text-xs text-gray-600">
            {rec.scheduled.map(run => (
              <li key={run.orderId}>
                <span className="font-mono">{run.orderNumber}</span> · {shortDateLabel(run.plannedDate)} · {run.finishedGoodName}: {amount(run.quantity)}
                {run.overdue && <span className="text-amber-700"> (overdue)</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rec.onOrder.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-gray-500">Already on order for {rec.branchName}</p>
          <ul className="mt-0.5 space-y-0.5 text-xs text-gray-600">
            {rec.onOrder.map(line => (
              <li key={`${line.documentId}:${line.quantity}`}>
                <span className="font-mono">{line.number}</span> ({line.status.toLowerCase().replaceAll('_', ' ')}): {amount(line.quantity)}
                {line.expected && <> · due {shortDateLabel(line.expected)}</>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rec.unassigned.length > 0 && (
        <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
          {amount(rec.unassignedTotal)} is on {rec.unassigned.map(line => line.number).join(', ')}, which name no kitchen, so it is
          not counted. If it is for {rec.branchName}, order less.
        </p>
      )}

      {canRequest && rec.orderNeeded && (
        <div className="mt-4">
          <Link
            href={`/procurement/requests/new?${new URLSearchParams({ reorder: rec.position })}`}
            className={`${primaryButtonClass} inline-flex items-center`}
          >
            Create purchase request →
          </Link>
          <p className="mt-1 text-xs text-gray-400">Opens the form pre-filled; you can change it before saving.</p>
        </div>
      )}

      <div className="mt-4 rounded-lg border border-purple-100 bg-purple-50/40 px-3 py-3">
        {writing && <AutoRefresh seconds={WRITING_REFRESH_SECONDS} />}
        <AiInsightPanel
          insight={rec.insight}
          type="REORDER_RECOMMENDATION"
          referenceId={rec.position}
          canGenerate={canExplain}
          title="Why this order"
          empty="KitchenAI can explain this recommendation in plain words."
          firstLabel="Explain"
          writing="Claude is explaining this recommendation…"
          checkHint="The figures above are the system's."
          costHint="Under a cent."
        >
          {rec.insight?.content && (
            <>
              {rec.figuresChanged && (
                <p className="mb-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                  The figures have changed since this was written. Regenerate for an explanation of the ones above.
                </p>
              )}
              <p className="whitespace-pre-line text-sm text-gray-800">{rec.insight.content}</p>
            </>
          )}
        </AiInsightPanel>
      </div>
    </div>
  )
}
