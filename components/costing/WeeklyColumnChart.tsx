import { shortDateLabel } from '@/lib/dates'
import { formatPeso } from '@/lib/format'
import type { CostingWeekDto } from '@/services/costing.service'

/**
 * One stacked column per week (Week 8 Task 6, C7), drawn as SVG on the
 * server: no chart library, no client JavaScript. Every chart that shares
 * this geometry lines its weeks up with the others, so the cost and loss
 * charts can be read one above the other.
 *
 * Hovering a week shows its figures (the browser's own tooltip, from
 * <title>); the table under the charts has every value, so nothing is
 * readable only by hovering.
 */

export type ColumnSeries = {
  label: string
  /** A CHART_COLORS entry. */
  color: string
  /** Pesos as Decimal strings, one per week, in the weeks' order. */
  values: string[]
}

type Props = {
  title: string
  weeks: Pick<CostingWeekDto, 'start' | 'end' | 'isCurrent'>[]
  series: ColumnSeries[]
  /** Pesos as Decimal strings: each week's total, labelled on the tallest column and this week's. */
  totals: string[]
  plotHeight: number
  empty: string
}

// The viewBox; the SVG scales to its container, which scrolls sideways below
// MIN_WIDTH rather than shrinking the text past reading.
const WIDTH     = 720
const MIN_WIDTH = 560
const LEFT      = 64
const RIGHT     = 12
const TOP       = 22
const BOTTOM    = 26
const MAX_BAR   = 24
const GAP       = 2
const RADIUS    = 4
/** A figure too small to see at the chart's scale still shows, at this height. */
const MIN_PART  = 2
/** Roughly how wide a label is at 11px per character, to keep labels apart and inside. */
const CHAR      = 6.6
/** A value label needs about this much room above its column, or it lands on the neighbours. */
const LABEL_SLOT = 44

export function WeeklyColumnChart({ title, weeks, series, totals, plotHeight, empty }: Props) {
  // Number() only places marks; every figure shown is formatted from the Decimal string.
  const amounts = totals.map(Number)
  const highest = Math.max(0, ...amounts)
  const { max, ticks } = axis(highest)

  const plotWidth = WIDTH - LEFT - RIGHT
  const slot      = plotWidth / weeks.length
  const barWidth  = Math.min(MAX_BAR, slot * 0.6)
  const baseline  = TOP + plotHeight
  const toY       = (value: number) => baseline - (value / max) * plotHeight
  // Label every week up to 13, then thin out counting back from this week, so it is always labelled.
  const every     = weeks.length <= 13 ? 1 : weeks.length <= 26 ? 2 : 4
  const tallest   = amounts.indexOf(highest)

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-800">{title}</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
          {series.map(entry => (
            <li key={entry.label} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: entry.color }} />
              {entry.label}
            </li>
          ))}
        </ul>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${WIDTH} ${TOP + plotHeight + BOTTOM}`}
          className="w-full"
          style={{ minWidth: MIN_WIDTH }}
          role="img"
          aria-label={`${title}, by week. The table below has every figure.`}
        >
          {ticks.map(tick => (
            <g key={tick}>
              <line x1={LEFT} x2={WIDTH - RIGHT} y1={toY(tick)} y2={toY(tick)} stroke={tick === 0 ? '#d1d5db' : '#f0f0f0'} strokeWidth={1} />
              <text x={LEFT - 8} y={toY(tick)} dy="0.32em" textAnchor="end" fontSize={11} fill="#6b7280" className="tabular-nums">
                {axisPeso(tick, max)}
              </text>
            </g>
          ))}

          {highest === 0 && (
            <text x={LEFT + plotWidth / 2} y={TOP + plotHeight / 2} textAnchor="middle" fontSize={12} fill="#9ca3af">{empty}</text>
          )}

          {weeks.map((week, index) => {
            const centre = LEFT + slot * (index + 0.5)
            const left   = centre - barWidth / 2
            const painted = series
              .map(entry => ({ entry, value: Number(entry.values[index]) }))
              .filter(part => part.value > 0)

            let floor = baseline
            const segments = painted.map((part, position) => {
              // The surface gap sits between segments, taken from the upper one.
              const bottom = position === 0 ? floor : floor - GAP
              const top    = Math.min(floor - (part.value / max) * plotHeight, bottom - MIN_PART)
              floor = top
              return { ...part, top, bottom, last: position === painted.length - 1 }
            })

            const label = slot >= LABEL_SLOT && (index === tallest && highest > 0 || week.isCurrent && amounts[index] > 0)
            const weekLabel = inside(centre, shortDateLabel(week.start))
            const tip = [
              `${week.isCurrent ? 'This week' : 'Week of'} ${shortDateLabel(week.start)} – ${shortDateLabel(week.end)}`,
              ...series.map(entry => `${entry.label}: ${formatPeso(entry.values[index])}`),
              `Total: ${formatPeso(totals[index])}`,
            ].join('\n')

            return (
              <g key={week.start} className="group">
                <title>{tip}</title>
                {segments.map(segment => segment.bottom - segment.top > 0 && (
                  <path
                    key={segment.entry.label}
                    d={column(left, barWidth, segment.top, segment.bottom, segment.last ? RADIUS : 0)}
                    fill={segment.entry.color}
                    className="transition-opacity group-hover:opacity-75"
                  />
                ))}
                {label && (
                  <text
                    x={inside(centre, axisPeso(amounts[index], max)).x}
                    y={floor - 6}
                    textAnchor={inside(centre, axisPeso(amounts[index], max)).anchor}
                    fontSize={11}
                    fill="#374151"
                    className="tabular-nums"
                  >
                    {axisPeso(amounts[index], max)}
                  </text>
                )}
                {(weeks.length - 1 - index) % every === 0 && (
                  <text
                    x={weekLabel.x}
                    y={baseline + 17}
                    textAnchor={weekLabel.anchor}
                    fontSize={11}
                    fill={week.isCurrent ? '#111827' : '#6b7280'}
                    fontWeight={week.isCurrent ? 600 : 400}
                  >
                    {shortDateLabel(week.start)}
                  </text>
                )}
                {/* The hit area is the whole week's slot, not just the painted column. */}
                <rect x={LEFT + slot * index} y={TOP} width={slot} height={plotHeight} fill="transparent" />
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

/** Centred on `centre`, unless that would run past the chart's edge: then flush with it. */
function inside(centre: number, text: string): { x: number; anchor: 'start' | 'middle' | 'end' } {
  const half = (text.length * CHAR) / 2
  if (centre + half > WIDTH) return { x: WIDTH, anchor: 'end' }
  if (centre - half < LEFT) return { x: LEFT, anchor: 'start' }
  return { x: centre, anchor: 'middle' }
}

/** A column from `top` to `bottom`, its top corners rounded by `radius`, square at the bottom. */
function column(left: number, width: number, top: number, bottom: number, radius: number): string {
  const r = Math.min(radius, bottom - top, width / 2)
  const right = left + width
  return [
    `M${left},${bottom}`,
    `L${left},${top + r}`,
    `Q${left},${top} ${left + r},${top}`,
    `L${right - r},${top}`,
    `Q${right},${top} ${right},${top + r}`,
    `L${right},${bottom}`,
    'Z',
  ].join(' ')
}

/** A rounded axis top and four or five clean ticks: 1, 2, 2.5 or 5 × a power of ten apart. */
function axis(highest: number): { max: number; ticks: number[] } {
  if (highest <= 0) return { max: 1000, ticks: [0, 250, 500, 750, 1000] }
  const rough = highest / 4
  const power = 10 ** Math.floor(Math.log10(rough))
  const step  = [1, 2, 2.5, 5, 10].map(factor => factor * power).find(candidate => candidate >= rough) ?? 10 * power
  const max   = Math.ceil(highest / step) * step
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, index) => index * step)
  return { max, ticks }
}

/** Axis pesos, one style per axis: in full below ₱10,000 (₱2,500), compact from there (₱15K). */
function axisPeso(value: number, max: number): string {
  if (max < 10_000 || value === 0) return `₱${Math.round(value).toLocaleString('en-PH')}`
  const thousands = value / 1000
  return `₱${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}K`
}
