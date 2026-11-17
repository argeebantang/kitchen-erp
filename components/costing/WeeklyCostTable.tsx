import { shortDateLabel } from '@/lib/dates'
import { formatPeso } from '@/lib/format'
import { WRITE_OFF_REASONS } from '@/services/write-off.service'
import type { CostingFiguresDto, CostingWeekDto } from '@/services/costing.service'

/**
 * Every figure behind the weekly charts, newest week first, with the range's
 * total underneath (Week 8 Task 6, C7, C10): what production cost, what was
 * written off by reason, what transfers lost, and the share of production
 * cost lost. No hooks and no 'use client', so it renders on the server.
 */
export function WeeklyCostTable({ weeks, totals }: { weeks: CostingWeekDto[]; totals: CostingFiguresDto }) {
  const newestFirst = [...weeks].reverse()

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
          <tr>
            <th rowSpan={2} className="px-3 py-2 text-left font-medium">Week</th>
            <th colSpan={3} className="border-l border-gray-200 px-3 pt-2 text-center font-medium">Production cost</th>
            <th colSpan={WRITE_OFF_REASONS.length + 1} className="border-l border-gray-200 px-3 pt-2 text-center font-medium">Lost</th>
            <th rowSpan={2} className="border-l border-gray-200 px-3 py-2 text-right font-medium">Total lost</th>
            <th rowSpan={2} className="px-3 py-2 text-right font-medium">% of cost</th>
          </tr>
          <tr>
            <th className="border-l border-gray-200 px-3 pb-2 text-right font-medium">Batches</th>
            <th className="px-3 pb-2 text-right font-medium">Conversions</th>
            <th className="px-3 pb-2 text-right font-medium">Total</th>
            {WRITE_OFF_REASONS.map(reason => (
              <th key={reason.value} className={`px-3 pb-2 text-right font-medium ${reason === WRITE_OFF_REASONS[0] ? 'border-l border-gray-200' : ''}`}>
                {reason.label}
              </th>
            ))}
            <th className="px-3 pb-2 text-right font-medium">Transfers</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {newestFirst.map(week => (
            <tr key={week.start} className={week.isCurrent ? 'bg-orange-50/40' : undefined}>
              <td className="whitespace-nowrap px-3 py-2 text-gray-800">
                {shortDateLabel(week.start)} – {shortDateLabel(week.end)}
                {week.isCurrent && <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-700">this week</span>}
              </td>
              <Figures figures={week} />
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-gray-200 bg-gray-50 font-medium">
          <tr>
            <td className="px-3 py-2 text-gray-800">{weeks.length} weeks</td>
            <Figures figures={totals} />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function Figures({ figures }: { figures: CostingFiguresDto }) {
  return (
    <>
      <Amount value={figures.batches} count={figures.batchCount} border />
      <Amount value={figures.conversion} count={figures.conversionCount} />
      <Amount value={figures.production} />
      {WRITE_OFF_REASONS.map(reason => (
        <Amount key={reason.value} value={figures.writeOffs[reason.value]} loss border={reason === WRITE_OFF_REASONS[0]} />
      ))}
      <Amount value={figures.transferLoss} count={figures.shortTransferCount} loss />
      <Amount value={figures.lost} loss border />
      <td className="px-3 py-2 text-right tabular-nums text-gray-700">{figures.lostPercent === null ? '—' : `${figures.lostPercent}%`}</td>
    </>
  )
}

/** A peso cell; a loss of nothing is a dash, so the losses stand out. */
function Amount({ value, count, loss = false, border = false }: { value: string; count?: number; loss?: boolean; border?: boolean }) {
  const nothing = Number(value) === 0
  return (
    <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${border ? 'border-l border-gray-100' : ''} ${loss && !nothing ? 'text-red-700' : 'text-gray-700'}`}>
      {loss && nothing ? <span className="text-gray-300">—</span> : formatPeso(value)}
      {count !== undefined && count > 0 && <span className="ml-1 text-xs text-gray-400">({count})</span>}
    </td>
  )
}
