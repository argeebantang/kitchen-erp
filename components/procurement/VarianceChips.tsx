import { formatPeso, trimDecimal } from '@/lib/format'

/**
 * A receiving line's variance as small labelled chips: short, over-delivered,
 * rejected, or a single "Match".
 *
 * No 'use client' and strings only, so the RR detail page (server) and the
 * receiving form (client) can both render it.
 */
type Props = {
  unit: string
  shortQuantity: string
  shortValue: string
  overQuantity: string
  overValue: string
  rejectedQuantity: string
  rejectedValue: string
}

function isZero(value: string) {
  return Number(value) === 0
}

export function VarianceChips(props: Props) {
  const parts = [
    { label: 'Short',          quantity: props.shortQuantity,    value: props.shortValue,    className: 'bg-amber-50 text-amber-700' },
    { label: 'Over-delivered', quantity: props.overQuantity,     value: props.overValue,     className: 'bg-orange-50 text-orange-700' },
    { label: 'Rejected',       quantity: props.rejectedQuantity, value: props.rejectedValue, className: 'bg-red-50 text-red-700' },
  ].filter(part => !isZero(part.quantity))

  if (parts.length === 0) {
    return <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">Match</span>
  }

  return (
    <div className="flex flex-col items-start gap-1">
      {parts.map(part => (
        <span key={part.label} className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${part.className}`}>
          {part.label} {trimDecimal(part.quantity)} {props.unit} · {formatPeso(part.value)}
        </span>
      ))}
    </div>
  )
}

/** A whole report at a glance, for lists: "Match" or "Variance · N lines". */
export function VarianceBadge({ varianceLineCount }: { varianceLineCount: number }) {
  if (varianceLineCount === 0) {
    return <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">Match</span>
  }
  return (
    <span className="whitespace-nowrap rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
      Variance · {varianceLineCount} {varianceLineCount === 1 ? 'line' : 'lines'}
    </span>
  )
}
