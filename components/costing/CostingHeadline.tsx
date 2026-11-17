import { formatPeso } from '@/lib/format'
import type { CostingWeekDto } from '@/services/costing.service'

/**
 * This week against last (Week 8 Task 6, C6): what production cost, how many
 * batches, what was lost and how much that is of what was made. No hooks and
 * no 'use client', so it renders on the server.
 */
export function CostingHeadline({ thisWeek, lastWeek }: { thisWeek: CostingWeekDto; lastWeek: CostingWeekDto }) {
  const anyLoss = thisWeek.writeOffCount + thisWeek.shortTransferCount > 0
  const tiles = [
    {
      label: 'Production cost',
      value: formatPeso(thisWeek.production),
      note:  `batches ${formatPeso(thisWeek.batches)} · conversions ${formatPeso(thisWeek.conversion)}`,
      last:  formatPeso(lastWeek.production),
      tone:  'text-gray-900',
    },
    {
      label: 'Batches completed',
      value: String(thisWeek.batchCount),
      note:  `and ${thisWeek.conversionCount} ${thisWeek.conversionCount === 1 ? 'conversion' : 'conversions'}`,
      last:  `${lastWeek.batchCount} + ${lastWeek.conversionCount}`,
      tone:  'text-gray-900',
    },
    {
      label: 'Lost',
      value: formatPeso(thisWeek.lost),
      note:  `write-offs ${formatPeso(thisWeek.writeOffTotal)} · transfers ${formatPeso(thisWeek.transferLoss)}`,
      last:  formatPeso(lastWeek.lost),
      tone:  anyLoss ? 'text-red-700' : 'text-emerald-700',
    },
    {
      label: 'Lost of production cost',
      value: thisWeek.lostPercent === null ? '—' : `${thisWeek.lostPercent}%`,
      note:  thisWeek.lostPercent === null ? 'nothing produced yet this week' : 'lost ÷ production cost',
      last:  lastWeek.lostPercent === null ? '—' : `${lastWeek.lostPercent}%`,
      tone:  anyLoss ? 'text-red-700' : 'text-emerald-700',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map(tile => (
        <div key={tile.label} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{tile.label}</p>
          <p className={`mt-0.5 text-xl font-semibold tabular-nums ${tile.tone}`}>{tile.value}</p>
          <p className="text-xs text-gray-400">{tile.note}</p>
          <p className="mt-1 border-t border-gray-100 pt-1 text-xs text-gray-500">
            Last week <span className="font-medium tabular-nums text-gray-700">{tile.last}</span>
          </p>
        </div>
      ))}
    </div>
  )
}
