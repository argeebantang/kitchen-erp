import { shortDateLabel } from '@/lib/dates'
import { formatPeso, formatQuantity } from '@/lib/format'
import type { CostingWeekDto, CostPerGoodDto } from '@/services/costing.service'
import { CHART_COLORS } from '@/components/costing/chart-colors'

/**
 * Cost per unit of each finished good over time (Week 8 Task 6, C8): one
 * small chart per good, each on its own scale — Lechon at ₱400/kg and Bopis
 * at ₱130/kg on one axis would flatten Bopis's trend into a line. A point is
 * a week the good was made; weeks without output have no point (never a
 * zero), and the line joins the weeks that had one. Hovering a point gives
 * its figures; the table underneath has them all. Rendered on the server.
 */
export function CostPerGood({ goods, weeks }: { goods: CostPerGoodDto[]; weeks: Pick<CostingWeekDto, 'start' | 'end'>[] }) {
  if (goods.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
        Nothing was made and signed off in these weeks.
      </p>
    )
  }

  // Weeks in which anything was made, newest first, for the table.
  const madeWeeks = weeks
    .map((week, index) => ({ week, index }))
    .filter(({ index }) => goods.some(good => good.weeks[index].costPerUnit !== null))
    .reverse()

  return (
    <>
      <div className="mb-4 grid gap-4 md:grid-cols-2">
        {goods.map(good => <GoodCard key={good.finishedGoodId} good={good} weeks={weeks} />)}
      </div>

      <details className="rounded-xl border border-gray-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Cost per unit by week, every figure
        </summary>
        <div className="overflow-x-auto border-t border-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Week</th>
                {goods.map(good => (
                  <th key={good.finishedGoodId} className="px-3 py-2 text-right font-medium">
                    {good.name} <span className="font-normal text-gray-400">per {good.unitAbbreviation}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {madeWeeks.map(({ week, index }) => (
                <tr key={week.start}>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-800">{shortDateLabel(week.start)} – {shortDateLabel(week.end)}</td>
                  {goods.map(good => {
                    const made = good.weeks[index]
                    return (
                      <td key={good.finishedGoodId} className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-700">
                        {made.costPerUnit === null ? <span className="text-gray-300">—</span> : (
                          <>
                            {formatPeso(made.costPerUnit)}
                            <span className="ml-1 text-xs text-gray-400">{formatQuantity(made.quantity)} {good.unitAbbreviation}</span>
                          </>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-200 bg-gray-50 font-medium">
              <tr>
                <td className="px-3 py-2 text-gray-800">Average, {weeks.length} weeks</td>
                {goods.map(good => (
                  <td key={good.finishedGoodId} className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-800">
                    {formatPeso(good.average)}
                    <span className="ml-1 text-xs font-normal text-gray-400">{formatQuantity(good.quantity)} {good.unitAbbreviation}</span>
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </details>
    </>
  )
}

// The card's chart viewBox.
const WIDTH  = 320
const HEIGHT = 120
const LEFT   = 48
const RIGHT  = 10
const TOP    = 10
const BOTTOM = 20

function GoodCard({ good, weeks }: { good: CostPerGoodDto; weeks: Pick<CostingWeekDto, 'start' | 'end'>[] }) {
  const unit = good.unitAbbreviation
  // Number() only places marks; every figure shown is formatted from the Decimal string.
  const points = good.weeks.flatMap((week, index) => week.costPerUnit === null ? [] : [{
    index,
    cost:     week.costPerUnit,
    quantity: week.quantity,
    value:    Number(week.costPerUnit),
  }])
  const { low, high, ticks } = scale(points.map(point => point.value))

  const plotWidth  = WIDTH - LEFT - RIGHT
  const plotHeight = HEIGHT - TOP - BOTTOM
  const slot = plotWidth / weeks.length
  const toX  = (index: number) => LEFT + slot * (index + 0.5)
  const toY  = (value: number) => TOP + plotHeight - ((value - low) / (high - low)) * plotHeight
  const line = points.map((point, order) => `${order === 0 ? 'M' : 'L'}${toX(point.index)},${toY(point.value)}`).join(' ')

  // A cost going up is bad news, so up is red; the arrow says which way without the colour.
  const change = good.changePercent
  const rising = change !== null && !change.startsWith('-')
  const flat   = change !== null && Number(change) === 0

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-800">{good.name}</p>
          <p className="text-xs text-gray-400">
            average {formatPeso(good.average)}/{unit} · {formatQuantity(good.quantity)} {unit} made
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold text-gray-900">
            {formatPeso(good.latest.costPerUnit)}<span className="text-sm font-normal text-gray-500">/{unit}</span>
          </p>
          <p className="text-xs text-gray-500">
            week of {shortDateLabel(good.latest.start)}
            {change !== null && (flat ? (
              <span className="ml-1.5">· unchanged since {shortDateLabel(good.first.start)}</span>
            ) : (
              <span className={`ml-1.5 font-medium ${rising ? 'text-red-700' : 'text-emerald-700'}`}>
                {rising ? '▲' : '▼'} {change.replace(/^-/, '')}% since {shortDateLabel(good.first.start)}
              </span>
            ))}
          </p>
        </div>
      </div>

      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label={`${good.name}, cost per ${unit} by week. The table below has every figure.`}>
        {ticks.map(tick => (
          <g key={tick}>
            <line x1={LEFT} x2={WIDTH - RIGHT} y1={toY(tick)} y2={toY(tick)} stroke="#f0f0f0" strokeWidth={1} />
            <text x={LEFT - 6} y={toY(tick)} dy="0.32em" textAnchor="end" fontSize={10} fill="#6b7280" className="tabular-nums">
              ₱{tick.toLocaleString('en-PH')}
            </text>
          </g>
        ))}
        <text x={LEFT} y={HEIGHT - 4} fontSize={10} fill="#6b7280">{shortDateLabel(weeks[0].start)}</text>
        <text x={WIDTH - RIGHT} y={HEIGHT - 4} textAnchor="end" fontSize={10} fill="#6b7280">{shortDateLabel(weeks[weeks.length - 1].start)}</text>

        <path d={line} fill="none" stroke={CHART_COLORS.batches} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map(point => (
          <g key={point.index} className="group">
            <title>
              {`Week of ${shortDateLabel(weeks[point.index].start)}: ${formatPeso(point.cost)}/${unit} · ${formatQuantity(point.quantity)} ${unit} made`}
            </title>
            <circle cx={toX(point.index)} cy={toY(point.value)} r={4} fill={CHART_COLORS.batches} stroke="#ffffff" strokeWidth={2} className="group-hover:opacity-75" />
            {/* A 24px hit area: a 4px dot is too small to land on. */}
            <circle cx={toX(point.index)} cy={toY(point.value)} r={12} fill="transparent" />
          </g>
        ))}
      </svg>
    </div>
  )
}

/** A value axis around the points, not from zero: these charts show change, not size. Three clean ticks. */
function scale(values: number[]): { low: number; high: number; ticks: number[] } {
  const min = Math.min(...values)
  const max = Math.max(...values)
  // A flat or single-point series still gets a band to sit in, a tenth of its value.
  const spread = max - min || max * 0.1 || 1
  const rough  = spread / 2
  const power  = 10 ** Math.floor(Math.log10(rough))
  const step   = [1, 2, 2.5, 5, 10].map(factor => factor * power).find(candidate => candidate >= rough) ?? 10 * power
  const low    = Math.floor((min - spread * 0.1) / step) * step
  const high   = Math.ceil((max + spread * 0.1) / step) * step
  const ticks  = Array.from({ length: Math.round((high - low) / step) + 1 }, (_, index) => low + index * step)
  return { low, high, ticks }
}
