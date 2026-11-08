import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft, ChevronRight, List } from 'lucide-react'
import { getSession } from '@/lib/session'
import { addMonths, monthGrid, monthLabel, MONTH_PATTERN, todayIsoDate } from '@/lib/dates'
import { inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'
import { ProductionOrderService, SCHEDULE_LIMIT } from '@/services/production-order.service'
import { BranchRepository } from '@/repositories/branch.repository'
import { CHIP_STYLES, ScheduleCalendar } from '@/components/production/ScheduleCalendar'

type PageProps = {
  searchParams: Promise<{ month?: string; branch?: string; closed?: string }>
}

const LEGEND: { status: string; label: string }[] = [
  { status: 'DRAFT',            label: 'Draft' },
  { status: 'PENDING_APPROVAL', label: 'Pending approval' },
  { status: 'APPROVED',         label: 'Approved' },
  { status: 'IN_PROGRESS',      label: 'In progress' },
  { status: 'COMPLETED',        label: 'Completed' },
]
const CLOSED_LEGEND = [
  { status: 'REJECTED',  label: 'Rejected' },
  { status: 'CANCELLED', label: 'Cancelled' },
]

/**
 * Production schedule (Week 5 Task 7): production orders on a month calendar
 * by production date. Read-only for every role allowed on /production;
 * planners also get "+" on today and later days to plan a run there.
 */
export default async function ProductionSchedulePage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  const canPlan = session.role === 'ADMIN' || session.role === 'PRODUCTION_MANAGER'

  const today = todayIsoDate()
  // Filters arrive as plain query strings from the GET form below. An invalid
  // month shows the current one and an unknown branch matches nothing, so a
  // mistyped link still opens.
  const { month: monthParam = '', branch = '', closed } = await searchParams
  const month         = MONTH_PATTERN.test(monthParam) ? monthParam : today.slice(0, 7)
  const includeClosed = closed === '1'

  const weeks = monthGrid(month)
  const [{ days, truncated }, branches] = await Promise.all([
    ProductionOrderService.schedule({
      from:     weeks[0][0],
      to:       weeks[weeks.length - 1][6],
      branchId: branch || undefined,
      includeClosed,
    }),
    BranchRepository.findAllActive(),
  ])
  const ordersThisMonth = Object.entries(days)
    .filter(([date]) => date.startsWith(month))
    .reduce((count, [, day]) => count + day.orders.length, 0)

  // Month links keep the filters, so paging through months doesn't reset them.
  const href = (target: string | null) => {
    const query = new URLSearchParams()
    if (target) query.set('month', target)
    if (branch) query.set('branch', branch)
    if (includeClosed) query.set('closed', '1')
    const text = query.toString()
    return text ? `/production/schedule?${text}` : '/production/schedule'
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Production Schedule</h1>
          <p className="mt-1 text-sm text-gray-400">
            Production orders by production date. Click one to open it.
            {canPlan && ' Use + on a day to plan a run for it.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href="/production/orders" className={`inline-flex items-center gap-1.5 ${secondaryButtonClass}`}>
            <List size={15} />
            List
          </Link>
          <Link href={href(addMonths(month, -1))} className={`${secondaryButtonClass} px-2`} aria-label="Previous month">
            <ChevronLeft size={16} />
          </Link>
          <span className="min-w-36 text-center text-sm font-semibold text-gray-800">{monthLabel(month)}</span>
          <Link href={href(addMonths(month, 1))} className={`${secondaryButtonClass} px-2`} aria-label="Next month">
            <ChevronRight size={16} />
          </Link>
          {month !== today.slice(0, 7) && (
            <Link href={href(null)} className={secondaryButtonClass}>Today</Link>
          )}
        </div>
      </div>

      {/* A GET form: the filters live in the URL, like the orders list. */}
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="month" value={month} />
        <label className="block min-w-48">
          <span className="mb-1 block text-xs font-medium text-gray-500">Branch</span>
          <select name="branch" defaultValue={branch} className={inputClass}>
            <option value="">All branches</option>
            {branches.map(option => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 py-2 text-sm text-gray-600">
          <input type="checkbox" name="closed" value="1" defaultChecked={includeClosed} className="h-4 w-4 accent-orange-500" />
          Show rejected &amp; cancelled
        </label>
        <button type="submit" className={primaryButtonClass}>Apply</button>
        {(branch || includeClosed) && (
          <Link href={`/production/schedule?month=${month}`} className={secondaryButtonClass}>Clear</Link>
        )}
      </form>

      {truncated && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          More than {SCHEDULE_LIMIT} orders fall in these weeks; only the first {SCHEDULE_LIMIT} are shown.
        </p>
      )}
      {ordersThisMonth === 0 && (
        <p className="mb-4 rounded-xl border border-dashed border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
          Nothing planned in {monthLabel(month)}{branch || includeClosed ? ' with these filters' : ''}.
        </p>
      )}

      <ScheduleCalendar weeks={weeks} month={month} days={days} today={today} canPlan={canPlan} />

      <ul className="mt-3 flex flex-wrap gap-2 text-xs">
        {[...LEGEND, ...(includeClosed ? CLOSED_LEGEND : [])].map(item => (
          <li key={item.status} className={`rounded border px-1.5 py-0.5 ${CHIP_STYLES[item.status]}`}>{item.label}</li>
        ))}
        <li className="px-1.5 py-0.5 text-gray-400">Day totals count only runs still going ahead or done.</li>
      </ul>
    </div>
  )
}
