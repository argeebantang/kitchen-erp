import Link from 'next/link'
import { trimDecimal } from '@/lib/format'
// Type-only: worked out on the server.
import type { DemandForecastDto, ForecastGoodDto } from '@/services/demand-forecast.service'
import { AiInsightPanel } from '@/components/ai/AiInsightPanel'
import { AutoRefresh } from '@/components/ui/AutoRefresh'
import { primaryButtonClass } from '@/components/ui/form'

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
/** While an explanation is being written, the page refreshes this often to show it. */
const WRITING_REFRESH_SECONDS = 4

/** "Tue, Nov 24". */
function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

const DEMAND_FROM: Record<ForecastGoodDto['demandFrom'], string> = {
  'requests':        'requests',
  'usual':           'usual',
  'requests-so-far': 'requests so far',
}

/**
 * FEATURE 5 — the Demand Forecaster on Production → Plan (Week 10 Task 5):
 * for one kitchen and day, how many batches of each good to cook, the working
 * behind it, the weekday pattern and past holidays, KitchenAI's explanation,
 * and a Plan production button per good.
 */
export function DemandPlan({ forecast, canPlan, canExplain }: { forecast: DemandForecastDto; canPlan: boolean; canExplain: boolean }) {
  const { goods } = forecast
  const weekdayIndex = WEEKDAY_SHORT.indexOf(forecast.weekday.slice(0, 3))
  const writing = forecast.insight?.status === 'PENDING'

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-800">
            {dayLabel(forecast.date)}{forecast.date === forecast.today && ' (today)'} · {forecast.kitchen.name}
          </h2>
          {forecast.holiday && (
            <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-sm font-medium text-amber-800">
              🎌 {forecast.holiday.name} — {forecast.holiday.typeLabel}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {forecast.requestsClosed
            ? 'The outlets’ requests for this day are in (the cut-off has passed): the plan follows them.'
            : `Requests stay open until ${forecast.cutoff} the day before. Until then, where the requests so far are below the usual amount for a ${forecast.weekday}, the usual amount is planned for.`}
        </p>

        {goods.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">Nothing is asked of this kitchen for that day, and it has no history to go by.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Good</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Requested</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Usual {forecast.weekday.slice(0, 3)}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Demand</th>
                  <th className="py-1.5 pr-3 text-right font-medium">− Stock still good</th>
                  <th className="py-1.5 pr-3 text-right font-medium">÷ Yield</th>
                  <th className="py-1.5 pr-3 text-right font-medium">− Planned</th>
                  <th className="py-1.5 pr-3 text-right font-medium">= Cook more</th>
                  <th className="py-1.5 text-right font-medium">Batches</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {goods.map(good => <GoodRow key={good.finishedGoodId} good={good} forecast={forecast} canPlan={canPlan} />)}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-gray-400">
              Usual: the average asked on the same weekday over the last {forecast.historyWeeks} weeks, holidays left out.
              Stock still good: finished stock at this kitchen that has not expired by the end of the day. Yield: this
              kitchen&apos;s completed runs of the last 30 days, never above 100 %. Planned: runs already on the schedule for
              the day.
            </p>
          </div>
        )}
      </section>

      {goods.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="text-base font-semibold text-gray-800">By day of the week</h3>
          <p className="text-xs text-gray-400">Average asked of this kitchen per day, last {forecast.historyWeeks} weeks, holidays left out.</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Good</th>
                  {WEEKDAY_SHORT.map((day, index) => (
                    <th key={day} className={`py-1.5 pr-3 text-right font-medium ${index === weekdayIndex ? 'text-orange-600' : ''}`}>{day}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {goods.map(good => (
                  <tr key={good.finishedGoodId}>
                    <td className="py-1.5 pr-3 text-gray-800">{good.name} <span className="text-xs text-gray-400">{good.unit}</span></td>
                    {good.byWeekday.map((value, index) => (
                      <td key={index} className={`py-1.5 pr-3 text-right tabular-nums ${index === weekdayIndex ? 'font-semibold text-orange-700' : 'text-gray-700'}`}>
                        {value === null ? '—' : trimDecimal(value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {forecast.pastHolidays.length > 0 && (
            <>
              <h4 className="mt-4 text-xs font-medium uppercase tracking-wide text-gray-500">Past holidays at this kitchen</h4>
              <ul className="mt-1 space-y-1 text-sm text-gray-700">
                {forecast.pastHolidays.map(holiday => (
                  <li key={holiday.date}>
                    <span className="font-medium">{holiday.name}</span> <span className="text-gray-400">({dayLabel(holiday.date)})</span>:{' '}
                    {holiday.goods.filter(good => good.ratio !== null).map(good => `${good.name} ${trimDecimal(good.asked)} vs ${trimDecimal(good.usual ?? '0')} usual (×${good.ratio})`).join(' · ') || 'no usual amount to compare with'}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {goods.length > 0 && (
        <section className="rounded-xl border border-purple-100 bg-purple-50/40 px-5 py-4">
          {writing && <AutoRefresh seconds={WRITING_REFRESH_SECONDS} />}
          <AiInsightPanel
            insight={forecast.insight}
            type="DEMAND_FORECAST"
            referenceId={forecast.position}
            canGenerate={canExplain}
            title="About this plan"
            empty="KitchenAI can explain this plan — what drives it, the weekday pattern and any holiday."
            firstLabel="Explain this plan"
            writing="Claude is going through the plan…"
            checkHint="The figures above are the system's."
            costHint="About a cent."
          >
            {forecast.insight?.content && (
              <>
                {forecast.figuresChanged && (
                  <p className="mb-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                    The figures have changed since this was written (new requests, stock or runs). Regenerate for the ones above.
                  </p>
                )}
                <p className="whitespace-pre-line text-sm text-gray-800">{forecast.insight.content}</p>
              </>
            )}
          </AiInsightPanel>
        </section>
      )}
    </div>
  )
}

function GoodRow({ good, forecast, canPlan }: { good: ForecastGoodDto; forecast: DemandForecastDto; canPlan: boolean }) {
  const unit = good.unit
  const amount = (value: string) => <>{trimDecimal(value)} <span className="text-xs text-gray-400">{unit}</span></>
  const planHref = `/production/orders/new?${new URLSearchParams({
    date: forecast.date, good: good.finishedGoodId, branch: forecast.kitchen.id, batches: String(good.batches),
  })}`

  return (
    <tr className="align-top">
      <td className="py-2 pr-3 font-medium text-gray-800">{good.name}</td>
      <td className="py-2 pr-3 text-right text-gray-700">
        {amount(good.requested)}
        <span className="block text-xs text-gray-400">
          {good.requestLines} {good.requestLines === 1 ? 'line' : 'lines'}{good.unanswered !== '0' && `, ${trimDecimal(good.unanswered)} unanswered`}
        </span>
      </td>
      <td className="py-2 pr-3 text-right text-gray-700">
        {good.usual ? amount(good.usual.average) : <span className="text-gray-400">—</span>}
        {good.usual && <span className="block text-xs text-gray-400">{trimDecimal(good.usual.min)}–{trimDecimal(good.usual.max)}, {good.usual.days} days</span>}
      </td>
      <td className="py-2 pr-3 text-right font-medium text-gray-800">
        {amount(good.demand)}
        <span className="block text-xs font-normal text-gray-400">from {DEMAND_FROM[good.demandFrom]}</span>
      </td>
      <td className="py-2 pr-3 text-right text-gray-700">{amount(good.stock)}</td>
      <td className="py-2 pr-3 text-right text-gray-700">
        {good.yieldPercent === null ? <span className="text-gray-400">100 %</span> : `${good.yieldPercent} %`}
        <span className="block text-xs text-gray-400">{good.yieldRuns > 0 ? `${good.yieldRuns} runs` : 'no runs yet'} → {trimDecimal(good.toCook)} {unit}</span>
      </td>
      <td className="py-2 pr-3 text-right text-gray-700">
        {amount(good.planned)}
        {good.plannedRuns.map(run => (
          <Link key={run.id} href={`/production/orders/${run.id}`} className="block font-mono text-xs text-orange-600 hover:underline">
            {run.orderNumber} · {run.status.toLowerCase().replaceAll('_', ' ')}
          </Link>
        ))}
      </td>
      <td className="py-2 pr-3 text-right font-semibold text-gray-900">{amount(good.more)}</td>
      <td className="py-2 text-right">
        {good.batches === 0 ? (
          <span className="text-emerald-700">Covered</span>
        ) : (
          <>
            <span className="font-semibold text-gray-900">{good.batches} × {trimDecimal(good.batchSize)} {unit}</span>
            {canPlan && (
              <Link href={planHref} className={`${primaryButtonClass} mt-1 block whitespace-nowrap px-2 py-1 text-center text-xs`}>
                Plan production →
              </Link>
            )}
          </>
        )}
      </td>
    </tr>
  )
}
