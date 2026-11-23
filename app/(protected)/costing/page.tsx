import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { shortDateLabel } from '@/lib/dates'
import {
  COSTING_RANGES,
  CostingService,
  DEFAULT_COSTING_RANGE,
  EXPENSIVE_BATCH_LIMIT,
  isCostingRange,
} from '@/services/costing.service'
import { CostingHeadline } from '@/components/costing/CostingHeadline'
import { WeeklyColumnChart } from '@/components/costing/WeeklyColumnChart'
import { WeeklyCostTable } from '@/components/costing/WeeklyCostTable'
import { CHART_COLORS } from '@/components/costing/chart-colors'
import { CostPerGood } from '@/components/costing/CostPerGood'
import { ExpensiveBatches } from '@/components/costing/ExpensiveBatches'

type PageProps = {
  searchParams: Promise<{ weeks?: string }>
}

/**
 * The costing dashboard (Week 8 Task 6): management sees what production cost
 * this week, which batches cost most, and what was lost to write-offs and
 * short transfers. ADMIN, ACCOUNTING, PRODUCTION_MANAGER and VIEWER
 * (middleware, C2).
 */
export default async function CostingPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')

  // An unknown range falls back to the default rather than an error, so a stale link still opens.
  const { weeks: weeksParam = '' } = await searchParams
  const requested = Number.parseInt(weeksParam, 10)
  const range = isCostingRange(requested) ? requested : DEFAULT_COSTING_RANGE

  const dashboard = await CostingService.dashboard(range, { userId: session.userId, role: session.role })
  const { thisWeek, lastWeek, weeks, totals, goods, expensiveBatches, awaiting } = dashboard
  const waiting = [
    awaiting.batches > 0     && `${awaiting.batches} ${awaiting.batches === 1 ? 'batch' : 'batches'} reported done`,
    awaiting.conversions > 0 && `${awaiting.conversions} ${awaiting.conversions === 1 ? 'conversion' : 'conversions'}`,
    awaiting.writeOffs > 0   && `${awaiting.writeOffs} ${awaiting.writeOffs === 1 ? 'write-off' : 'write-offs'}`,
  ].filter(part => part !== false)

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Costing</h1>
          <p className="mt-1 text-sm text-gray-400">
            This week is {shortDateLabel(thisWeek.start)} – {shortDateLabel(thisWeek.end)} (Monday to Sunday).
            Figures count once signed off: batches on the day cooked, write-offs on the day recorded, transfer shortfalls on the day received.
          </p>
          {/* Feature 7 (Week 10 Task 6): what a run would cost before it is planned. Not for VIEWER — /production is closed to it. */}
          {session.role !== 'VIEWER' && (
            <Link href="/production/plan#simulate" className="mt-1 inline-block text-sm font-medium text-orange-600 hover:underline">
              Simulate a run before planning it →
            </Link>
          )}
        </div>

        <nav aria-label="Range" className="flex overflow-hidden rounded-lg border border-gray-200 bg-white text-sm">
          {COSTING_RANGES.map(option => (
            <Link
              key={option}
              href={option === DEFAULT_COSTING_RANGE ? '/costing' : `/costing?weeks=${option}`}
              aria-current={option === range ? 'page' : undefined}
              className={`border-l border-gray-200 px-3 py-1.5 first:border-l-0 ${
                option === range ? 'bg-orange-500 font-medium text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {option} weeks
            </Link>
          ))}
        </nav>
      </div>

      {/* C4: figures count once signed off, so say what has not been yet. */}
      {waiting.length > 0 && (
        <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-medium">Not counted yet, awaiting accounting&apos;s approval:</span> {waiting.join(', ')} from these weeks.
          Each joins the figures, in the week it happened, once approved.
        </p>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-gray-800">This week</h2>
        <CostingHeadline thisWeek={thisWeek} lastWeek={lastWeek} />
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-lg font-semibold text-gray-800">Week by week</h2>
        <p className="mb-3 text-sm text-gray-400">
          {weeks.length} weeks from {shortDateLabel(weeks[0].start)} to {shortDateLabel(thisWeek.end)}; this week so far.
          Conversions count only the ingredients they added — the Lechon they used was counted as a batch.
        </p>
        <div className="mb-4 grid gap-4">
          <WeeklyColumnChart
            title="Production cost"
            weeks={weeks}
            series={[
              { label: 'Batches',                 color: CHART_COLORS.batches,    values: weeks.map(week => week.batches) },
              { label: 'Conversion ingredients',  color: CHART_COLORS.conversion, values: weeks.map(week => week.conversion) },
            ]}
            totals={weeks.map(week => week.production)}
            plotHeight={200}
            empty="Nothing produced and signed off in these weeks"
          />
          <WeeklyColumnChart
            title="Lost"
            weeks={weeks}
            series={[
              { label: 'Write-offs',         color: CHART_COLORS.writeOffs,    values: weeks.map(week => week.writeOffTotal) },
              { label: 'Transfer shortfall', color: CHART_COLORS.transferLoss, values: weeks.map(week => week.transferLoss) },
            ]}
            totals={weeks.map(week => week.lost)}
            plotHeight={120}
            empty="Nothing written off or lost in transit in these weeks"
          />
        </div>
        <WeeklyCostTable weeks={weeks} totals={totals} />
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-lg font-semibold text-gray-800">Cost per finished good</h2>
        <p className="mb-3 text-sm text-gray-400">
          What one unit cost to make, week by week: the week&apos;s cost ÷ what was made, so a big batch weighs more than a small one.
          Conversion output costs the source it used plus the ingredients added. Each chart has its own scale.
        </p>
        <CostPerGood goods={goods} weeks={weeks} />
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-lg font-semibold text-gray-800">Most expensive batches</h2>
        <p className="mb-3 text-sm text-gray-400">
          The {EXPENSIVE_BATCH_LIMIT} signed-off production runs that cost the most in these {weeks.length} weeks. &ldquo;vs plan&rdquo; is what
          the run cost beyond what that much output should have cost at the plan&apos;s prices; red is over.
        </p>
        <ExpensiveBatches batches={expensiveBatches} />
      </section>
    </div>
  )
}
