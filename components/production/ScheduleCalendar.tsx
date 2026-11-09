import Link from 'next/link'
import { Plus } from 'lucide-react'
import { trimDecimal } from '@/lib/format'
// Type-only: rendered on the server for /production/schedule.
import type { ScheduleDayDto } from '@/services/production-order.service'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Chip colours per status, from StatusBadge's palette. Completed is muted
 * rather than green like Approved: on a calendar, done work should recede.
 */
export const CHIP_STYLES: Record<string, string> = {
  DRAFT:              'border-gray-200 bg-gray-50 text-gray-600',
  PENDING_APPROVAL:   'border-amber-200 bg-amber-50 text-amber-800',
  APPROVED:           'border-emerald-200 bg-emerald-50 text-emerald-800',
  IN_PROGRESS:        'border-blue-200 bg-blue-50 text-blue-800',
  PENDING_COMPLETION: 'border-violet-200 bg-violet-50 text-violet-800',
  COMPLETED:          'border-slate-200 bg-slate-100 text-slate-500',
  REJECTED:           'border-red-200 bg-red-50 text-red-700 line-through',
  CANCELLED:          'border-gray-200 bg-white text-gray-400 line-through',
}

/**
 * The month grid (Week 5 Task 7). No state: a Server Component, so moving
 * between months is a link and the page renders again. Days outside the month
 * are dimmed but still show their orders, so a run on the 1st of next month is
 * visible from the last week of this one.
 */
export function ScheduleCalendar({
  weeks, month, days, today, canPlan,
}: {
  weeks: string[][]
  /** YYYY-MM being shown. */
  month: string
  days: Record<string, ScheduleDayDto>
  today: string
  /** Shows "+" on today and later days, opening the new-order form for that date. */
  canPlan: boolean
}) {
  return (
    // The grid needs about 7 × 8rem; on a phone it scrolls inside this box
    // rather than widening the page (D8).
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <div className="grid min-w-[56rem] grid-cols-7">
        {WEEKDAYS.map(name => (
          <div key={name} className="border-b border-gray-200 bg-gray-50 px-2 py-2 text-xs font-medium uppercase tracking-wide text-gray-500">
            {name}
          </div>
        ))}

        {weeks.flat().map((date, index) => {
          const day      = days[date]
          const inMonth  = date.startsWith(month)
          const isToday  = date === today
          return (
            <div
              key={date}
              className={`min-h-28 border-b border-gray-100 p-1.5 ${index % 7 === 6 ? '' : 'border-r'} ${inMonth ? '' : 'bg-gray-50/60'}`}
            >
              <div className="mb-1 flex items-center gap-1">
                <span
                  className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-medium ${
                    isToday ? 'bg-orange-500 text-white' : inMonth ? 'text-gray-700' : 'text-gray-400'
                  }`}
                >
                  {Number(date.slice(8, 10))}
                </span>
                {/* The day's load, per unit, summed in Decimal by the service (D5). */}
                {day && day.totals.length > 0 && (
                  <span className="text-xs font-medium text-gray-500">
                    {day.totals.map(total => `${trimDecimal(total.quantity)} ${total.unit}`).join(' · ')}
                  </span>
                )}
                {/* A production date cannot be in the past, so "+" starts today. */}
                {canPlan && date >= today && (
                  <Link
                    href={`/production/orders/new?date=${date}`}
                    title={`Plan a run on ${date}`}
                    aria-label={`Plan a run on ${date}`}
                    className="ml-auto rounded-md border border-gray-200 p-0.5 text-gray-500 transition-colors hover:border-orange-300 hover:bg-orange-50 hover:text-orange-600"
                  >
                    <Plus size={14} />
                  </Link>
                )}
              </div>

              <ul className="space-y-1">
                {day?.orders.map(order => (
                  <li key={order.id}>
                    <Link
                      href={`/production/orders/${order.id}`}
                      title={`${order.orderNumber} · ${order.finishedGoodName} · ${trimDecimal(order.plannedQty)} ${order.unitAbbreviation} · ${order.status.replace(/_/g, ' ').toLowerCase()}`}
                      className={`block rounded border px-1.5 py-0.5 text-xs leading-snug hover:brightness-95 ${CHIP_STYLES[order.status] ?? CHIP_STYLES.DRAFT}`}
                    >
                      <span className="font-mono">{order.orderNumber.replace('PRD-', '')}</span>
                      {' '}{order.finishedGoodName}{' '}
                      <span className="whitespace-nowrap font-medium">{trimDecimal(order.plannedQty)} {order.unitAbbreviation}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}
