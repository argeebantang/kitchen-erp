import { AiFeature, AiInsightStatus, AiInsightType, Prisma, type HolidayType, type ProductionStatus } from '@prisma/client'
import { config } from '@/lib/config'
import { addDays, businessDayRange, todayIsoDate } from '@/lib/dates'
import { trimDecimal } from '@/lib/format'
import { AI_JOB_OPTIONS, DEMAND_FORECAST_EXPLAIN, getAiQueue, type DemandForecastJob } from '@/lib/queue'
import { AiInsightRepository, type AiInsightReference } from '@/repositories/ai-insight.repository'
import { BomRepository } from '@/repositories/bom.repository'
import { BranchRepository } from '@/repositories/branch.repository'
import { DemandForecastRepository, type RequestedDayRow } from '@/repositories/demand-forecast.repository'
import { FinishedGoodStockRepository } from '@/repositories/finished-good-stock.repository'
import { AiService, toInsightDto, type AiInsightDto } from '@/services/ai.service'
import { HolidayService, HOLIDAY_TYPE_LABELS } from '@/services/holiday.service'
import { isLate } from '@/services/stock-request.service'

/**
 * FEATURE 5 — Demand Forecaster (Week 10 Task 5,
 * docs/2026-11-23-week10-demand-forecaster.md). On Production → Plan, for one
 * kitchen and one day, the code works out how many batches of each good to
 * cook (P1); Claude explains the plan, on request.
 *
 *   demand    = the day's requests once the cut-off has passed; before it, the
 *               larger of the requests so far and the usual amount — the
 *               average asked on the same weekday over the last HISTORY_WEEKS
 *               weeks, holidays left out
 *   to cover  = demand − finished stock at the kitchen still good that day
 *   to cook   = to cover ÷ the kitchen's yield on that good (last YIELD_DAYS
 *               days, never above 100 %) − runs already planned for the day
 *   batches   = to cook ÷ the recipe's batch size, rounded up
 *
 * Holidays (Master Data → Holidays) are shown, with how past ones went
 * against their usual weekday; the forecast does not scale for them — a
 * holiday's effect differs by holiday, and that call is left to the people
 * planning, with Claude's comment.
 */

export const HISTORY_WEEKS = 8
export const YIELD_DAYS = 30
/** How far back past holidays are looked for. */
export const PAST_HOLIDAY_DAYS = 120
/** How far ahead a plan can be looked at. */
export const PLAN_AHEAD_DAYS = 14
/** Explain / Regenerate, and the Plan production buttons: the kitchen's planners. */
export const FORECAST_GENERATE_ROLES = ['ADMIN', 'PRODUCTION_MANAGER']

const REFERENCE_TYPE = 'KitchenDay'
const ZERO = new Prisma.Decimal(0)
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

/** 0 = Monday … 6 = Sunday. */
function weekdayOf(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
}

/** "Tue, Nov 24". */
export function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function qty(value: Prisma.Decimal): string {
  return trimDecimal(value.toDecimalPlaces(3).toFixed(3))
}

function avg(values: Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce((total, value) => total.add(value), ZERO).div(values.length).toDecimalPlaces(2)
}

export type UsualDto = {
  /** Average asked on the same weekday, to 2 decimals. */
  average: string
  min: string
  max: string
  /** Same-weekday days it is over (holidays and days with no requests left out). */
  days: number
}

export type ForecastGoodDto = {
  finishedGoodId: string
  name: string
  code: string
  unit: string
  /** What the outlets' requests for the day ask the kitchen to send (planned once answered). */
  requested: string
  requestLines: number
  /** Of it, not yet answered by the kitchen. */
  unanswered: string
  usual: UsualDto | null
  demand: string
  /** Where demand comes from: the requests (cut-off passed), the usual amount (requests still open and below it), or the requests so far. */
  demandFrom: 'requests' | 'usual' | 'requests-so-far'
  /** Finished stock at the kitchen still good at the end of the day. */
  stock: string
  /** max(0, demand − stock). */
  toCover: string
  /** Completed runs here in the last YIELD_DAYS days: actual ÷ planned, 1 decimal; null with none. */
  yieldPercent: string | null
  yieldRuns: number
  /** to cover ÷ yield (capped at 100 %). */
  toCook: string
  plannedRuns: { id: string; orderNumber: string; status: ProductionStatus; plannedQty: string }[]
  planned: string
  /** max(0, to cook − planned). */
  more: string
  batchSize: string
  /** Batches of `batchSize` that cover `more`, rounded up; 0 when nothing more is needed. */
  batches: number
  /** Average asked per weekday, Monday first, over the last HISTORY_WEEKS weeks (holidays left out); null for a weekday with no days. */
  byWeekday: (string | null)[]
}

export type PastHolidayDto = {
  date: string
  name: string
  type: HolidayType
  goods: { finishedGoodId: string; name: string; unit: string; asked: string; usual: string | null; ratio: string | null }[]
}

export type DemandForecastDto = {
  /** '<kitchenId>:<date>' — the insight's referenceId. */
  position: string
  kitchen: { id: string; name: string }
  /** YYYY-MM-DD. */
  date: string
  today: string
  weekday: string
  holiday: { name: string; type: HolidayType; typeLabel: string } | null
  /** The day's requests are in: the cut-off on the day before has passed. */
  requestsClosed: boolean
  cutoff: string
  historyWeeks: number
  goods: ForecastGoodDto[]
  pastHolidays: PastHolidayDto[]
  insight: AiInsightDto | null
  /** The explanation was written from different figures. */
  figuresChanged: boolean
}

export type PlanOptionsDto = {
  kitchens: { id: string; name: string }[]
  /** YYYY-MM-DD, the first and last day a plan can be looked at. */
  from: string
  to: string
}

export type ForecastResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status: number }

function reference(position: string): AiInsightReference {
  return { type: AiInsightType.DEMAND_FORECAST, referenceType: REFERENCE_TYPE, referenceId: position }
}

function parsePosition(position: string): { kitchenId: string; date: string } | null {
  const match = /^([A-Za-z0-9_-]{1,40}):(\d{4}-\d{2}-\d{2})$/.exec(position)
  return match ? { kitchenId: match[1], date: match[2] } : null
}

/** What the explanation's check compares: if any of these moved, the text may no longer fit. */
function checkOf(forecast: Pick<DemandForecastDto, 'goods' | 'requestsClosed' | 'holiday'>) {
  return {
    requestsClosed: forecast.requestsClosed,
    holiday:        forecast.holiday?.name ?? null,
    goods:          forecast.goods.map(good => [good.code, good.demand, good.stock, good.planned, good.batches]),
  }
}

function figuresMoved(facts: Prisma.JsonValue | null, forecast: DemandForecastDto): boolean {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) return false
  return JSON.stringify((facts as Record<string, unknown>).check) !== JSON.stringify(checkOf(forecast))
}

/** The days a plan can be looked at, and the kitchens. */
async function options(): Promise<PlanOptionsDto> {
  const today = todayIsoDate()
  return { kitchens: await BranchRepository.findActiveKitchens(), from: today, to: addDays(today, PLAN_AHEAD_DAYS) }
}

/**
 * The forecast for one kitchen and day, with its stored explanation. Null for
 * an unknown or inactive kitchen, or a day outside today … +PLAN_AHEAD_DAYS.
 */
async function forecast(kitchenId: string, date: string): Promise<DemandForecastDto | null> {
  const today = todayIsoDate()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today || date > addDays(today, PLAN_AHEAD_DAYS)) return null
  const kitchen = (await BranchRepository.findActiveKitchens()).find(row => row.id === kitchenId)
  if (!kitchen) return null

  const position = `${kitchenId}:${date}`
  const historyFrom = addDays(today, -(PAST_HOLIDAY_DAYS + HISTORY_WEEKS * 7))
  const [requested, holidays, boms, levels, runs, yields, stored] = await Promise.all([
    DemandForecastRepository.requestedByDay(kitchenId, historyFrom, date),
    HolidayService.between(historyFrom, date),
    BomRepository.findAllActiveForPlanning(),
    FinishedGoodStockRepository.findLevels({ branchId: kitchenId, take: 2000 }),
    DemandForecastRepository.plannedRuns(kitchenId, date),
    DemandForecastRepository.yields(kitchenId, addDays(today, -YIELD_DAYS)),
    AiInsightRepository.findMany(AiInsightType.DEMAND_FORECAST, REFERENCE_TYPE, [position]),
  ])

  // asked[day][good]; a day is covered when the kitchen had any request on it.
  const byDay = new Map<string, Map<string, RequestedDayRow>>()
  for (const row of requested) {
    const day = byDay.get(row.day) ?? new Map<string, RequestedDayRow>()
    day.set(row.finishedGoodId, row)
    byDay.set(row.day, day)
  }
  const holidayOn = new Map(holidays.map(holiday => [holiday.date, holiday]))
  const askedOn = (day: string, goodId: string) => byDay.get(day)?.get(goodId)?.asked ?? ZERO
  /** A past day the history can learn from: requests on it, not a holiday. */
  const usable = (day: string) => day < today && byDay.has(day) && !holidayOn.has(day)

  /** The same weekday over the HISTORY_WEEKS weeks before `day`, holidays left out. */
  function usual(goodId: string, day: string): UsualDto | null {
    const samples: Prisma.Decimal[] = []
    for (let week = 1; week <= HISTORY_WEEKS; week++) {
      const sample = addDays(day, -7 * week)
      if (usable(sample)) samples.push(askedOn(sample, goodId))
    }
    if (samples.length === 0) return null
    return {
      average: qty(avg(samples)),
      min:     qty(Prisma.Decimal.min(...samples)),
      max:     qty(Prisma.Decimal.max(...samples)),
      days:    samples.length,
    }
  }

  // The weekday profile: the last HISTORY_WEEKS weeks before today.
  function byWeekday(goodId: string): (string | null)[] {
    const samples: Prisma.Decimal[][] = WEEKDAYS.map(() => [])
    for (let back = 1; back <= HISTORY_WEEKS * 7; back++) {
      const day = addDays(today, -back)
      if (usable(day)) samples[weekdayOf(day)].push(askedOn(day, goodId))
    }
    return samples.map(values => (values.length === 0 ? null : qty(avg(values))))
  }

  const requestsClosed = isLate(date, new Date(), config.stockRequestCutoff)
  const goodThrough = businessDayRange(addDays(date, 1)).start
  const yieldOf = new Map(yields.map(row => [row.finishedGoodId, row]))

  const goods: ForecastGoodDto[] = []
  for (const bom of boms) {
    const goodId = bom.finishedGood.id
    const request = byDay.get(date)?.get(goodId)
    const requestedQty = request?.toSend ?? ZERO
    const usualQty = usual(goodId, date)
    const usualAverage = usualQty ? new Prisma.Decimal(usualQty.average) : null

    let demand = requestedQty
    let demandFrom: ForecastGoodDto['demandFrom'] = requestsClosed ? 'requests' : 'requests-so-far'
    if (!requestsClosed && usualAverage && usualAverage.gt(requestedQty)) {
      demand = usualAverage
      demandFrom = 'usual'
    }

    const stock = levels
      .filter(level => level.lot.finishedGood.id === goodId && level.quantity.gt(0)
        && (level.lot.expiresAt === null || level.lot.expiresAt >= goodThrough))
      .reduce((total, level) => total.add(level.quantity), ZERO)
    const toCover = Prisma.Decimal.max(demand.sub(stock), ZERO)

    const history = yieldOf.get(goodId)
    const measured = history && history.planned.gt(0) ? history.actual.div(history.planned) : null
    const yieldUsed = measured ? Prisma.Decimal.min(measured, 1) : new Prisma.Decimal(1)
    const toCook = toCover.div(yieldUsed).toDecimalPlaces(3, Prisma.Decimal.ROUND_UP)

    const goodRuns = runs.filter(run => run.finishedGoodId === goodId)
    const planned = goodRuns.reduce((total, run) => total.add(run.plannedQty), ZERO)
    const more = Prisma.Decimal.max(toCook.sub(planned), ZERO)
    const batches = more.gt(0) ? more.div(bom.batchSize).ceil().toNumber() : 0

    // A good nobody asks for, with nothing on hand or planned, is not part of the day.
    if (demand.isZero() && stock.isZero() && planned.isZero() && (!usualAverage || usualAverage.isZero())) continue

    goods.push({
      finishedGoodId: goodId,
      name:           bom.finishedGood.name,
      code:           bom.finishedGood.code,
      unit:           bom.batchUnit.abbreviation,
      requested:      qty(requestedQty),
      requestLines:   request?.requests ?? 0,
      unanswered:     qty(request?.unanswered ?? ZERO),
      usual:          usualQty,
      demand:         qty(demand),
      demandFrom,
      stock:          qty(stock),
      toCover:        qty(toCover),
      yieldPercent:   measured ? measured.mul(100).toDecimalPlaces(1).toFixed(1) : null,
      yieldRuns:      history?.runs ?? 0,
      toCook:         qty(toCook),
      plannedRuns:    goodRuns.map(run => ({ id: run.id, orderNumber: run.orderNumber, status: run.status, plannedQty: qty(run.plannedQty) })),
      planned:        qty(planned),
      more:           qty(more),
      batchSize:      qty(bom.batchSize),
      batches,
      byWeekday:      byWeekday(goodId),
    })
  }

  // How past holidays went, against their own usual weekday.
  const pastHolidays: PastHolidayDto[] = holidays
    .filter(holiday => holiday.date >= addDays(today, -PAST_HOLIDAY_DAYS) && holiday.date < today && byDay.has(holiday.date))
    .map(holiday => ({
      date: holiday.date,
      name: holiday.name,
      type: holiday.type,
      goods: goods.map(good => {
        const asked = askedOn(holiday.date, good.finishedGoodId)
        const base = usual(good.finishedGoodId, holiday.date)
        const baseValue = base ? new Prisma.Decimal(base.average) : null
        return {
          finishedGoodId: good.finishedGoodId,
          name:           good.name,
          unit:           good.unit,
          asked:          qty(asked),
          usual:          base?.average ?? null,
          ratio:          baseValue && baseValue.gt(0) ? asked.div(baseValue).toDecimalPlaces(2).toFixed(2) : null,
        }
      }),
    }))

  const holiday = holidayOn.get(date)
  const result: DemandForecastDto = {
    position,
    kitchen,
    date,
    today,
    weekday:        WEEKDAYS[weekdayOf(date)],
    holiday:        holiday ? { name: holiday.name, type: holiday.type, typeLabel: HOLIDAY_TYPE_LABELS[holiday.type] } : null,
    requestsClosed,
    cutoff:         config.stockRequestCutoff,
    historyWeeks:   HISTORY_WEEKS,
    goods,
    pastHolidays,
    insight:        null,
    figuresChanged: false,
  }
  const [row] = stored
  if (row) {
    result.insight = toInsightDto(row)
    result.figuresChanged = row.status === AiInsightStatus.READY && figuresMoved(row.facts, result)
  }
  return result
}

/** What Claude is given — the plan as the page shows it. Stored on the insight. */
function explanationFacts(forecast: DemandForecastDto) {
  return {
    kitchen:  forecast.kitchen.name,
    day:      `${dayLabel(forecast.date)} (${forecast.weekday})${forecast.date === forecast.today ? ', today' : ''}`,
    holiday:  forecast.holiday ? `${forecast.holiday.name} — ${forecast.holiday.typeLabel}` : null,
    requests: forecast.requestsClosed
      ? 'closed: the outlets\' requests for the day are in'
      : `still open until ${forecast.cutoff} the day before; where the requests so far are below the usual amount, the usual amount is used`,
    usualMeans: `the average asked on the same weekday over the last ${forecast.historyWeeks} weeks, holidays left out`,
    goods: forecast.goods.map(good => ({
      good:          good.name,
      unit:          good.unit,
      requested:     `${good.requested} (${good.requestLines} request lines${good.unanswered !== '0' ? `, ${good.unanswered} not yet answered` : ''})`,
      usual:         good.usual ? `${good.usual.average} (between ${good.usual.min} and ${good.usual.max}, over ${good.usual.days} days)` : 'no history',
      demand:        `${good.demand} from ${good.demandFrom === 'usual' ? 'the usual amount' : good.demandFrom === 'requests' ? 'the requests' : 'the requests so far'}`,
      stockStillGood: good.stock,
      toCover:       good.toCover,
      yield:         good.yieldPercent ? `${good.yieldPercent}% over ${good.yieldRuns} runs in the last ${YIELD_DAYS} days` : 'no completed runs to learn from — 100% assumed',
      toCook:        good.toCook,
      alreadyPlanned: good.plannedRuns.length > 0
        ? `${good.planned} on ${good.plannedRuns.map(run => `${run.orderNumber} (${run.status.toLowerCase().replaceAll('_', ' ')})`).join(', ')}`
        : '0',
      planMore:      `${good.more} = ${good.batches} batch${good.batches === 1 ? '' : 'es'} of ${good.batchSize}`,
      averageAskedByWeekday: Object.fromEntries(WEEKDAYS.map((day, index) => [day.slice(0, 3), good.byWeekday[index]])),
    })),
    pastHolidays: forecast.pastHolidays.map(holiday => ({
      holiday: `${holiday.name}, ${dayLabel(holiday.date)}`,
      askedAgainstUsual: holiday.goods
        .filter(good => good.ratio !== null)
        .map(good => `${good.name}: ${good.asked} against ${good.usual} usual (×${good.ratio})`),
    })),
    check: checkOf(forecast),
  }
}

const INSTRUCTIONS = `You explain a kitchen's production plan for one day to the kitchen supervisor of Lydia's Lechon. The system has already worked out every figure: quote them as given; do not recalculate, re-round or add figures of your own.

Write at most 6 sentences and under 130 words, in plain text with no headings, lists or Markdown. The day planned is usually not today: call it by its date or weekday, and say "today" only when the figures say it is today.
- Start with the plan: how many batches of each good to cook (or that the runs already planned cover it).
- Say what drives it: the requests, or the usual amount for the weekday when requests are still open; finished stock still good; runs already planned. Mention a yield only where it is below 95%.
- If the day is a holiday, say so and how the past holidays in the figures went for these goods. You may advise cooking more or less than the plan when past holidays clearly point that way, as advice ("consider one more batch of Lechon"), never as a new figure.
- Point out the weekday pattern only when it explains this day.
Do not suggest causes the figures do not show.`

async function request(position: string, requestedById: string | null, options: { regenerate?: boolean } = {}): Promise<ForecastResult<{ queued: boolean }>> {
  const parsed = parsePosition(position)
  if (!parsed) return { success: false, error: 'Unknown kitchen and day', status: 400 }
  const current = await forecast(parsed.kitchenId, parsed.date)
  if (!current) return { success: false, error: `Only an active kitchen, from today to ${PLAN_AHEAD_DAYS} days ahead, can be explained`, status: 409 }
  if (current.goods.length === 0) return { success: false, error: 'There is nothing to plan for that day', status: 409 }

  const ref = reference(position)
  const asked = options.regenerate ? await AiInsightRepository.regenerate(ref) : await AiInsightRepository.request(ref)
  if (!asked) return { success: true, data: { queued: false } }
  try {
    await getAiQueue().add(DEMAND_FORECAST_EXPLAIN, { position, requestedById } satisfies DemandForecastJob, AI_JOB_OPTIONS)
  } catch (err) {
    console.error('[DemandForecastService] could not queue the explanation', err)
    await AiInsightRepository.fail(ref, { error: 'Could not queue the explanation (the job queue is unavailable). Try again.' })
  }
  return { success: true, data: { queued: true } }
}

export type ExplainOutcome = 'READY' | 'FAILED' | 'RETRY' | 'SKIPPED'

/** Writes a PENDING explanation from the figures as they are now. Same outcome rules as Feature 1. */
async function explain(position: string, options: { userId: string | null; lastAttempt: boolean }): Promise<ExplainOutcome> {
  const ref = reference(position)
  const current = await AiInsightRepository.find(ref)
  if (current?.status !== AiInsightStatus.PENDING) return 'SKIPPED'

  const parsed = parsePosition(position)
  const plan = parsed ? await forecast(parsed.kitchenId, parsed.date) : null
  if (!plan || plan.goods.length === 0) {
    await AiInsightRepository.fail(ref, { error: 'That day can no longer be planned here.' })
    return 'FAILED'
  }

  const facts  = explanationFacts(plan)
  const prompt = `Explain the production plan for ${plan.kitchen.name} on ${dayLabel(plan.date)}.\n\n<figures>\n${JSON.stringify(facts, null, 2)}\n</figures>`
  const result = await AiService.complete({
    feature:      AiFeature.DEMAND_FORECAST,
    instructions: INSTRUCTIONS,
    messages:     [{ role: 'user', content: prompt }],
    userId:       options.userId,
  })

  if (result.success) {
    const content = result.data.text.trim()
    if (content !== '') {
      await AiInsightRepository.complete(ref, { content, facts, prompt, model: result.data.servedModel, aiCallId: result.data.callId })
      return 'READY'
    }
    await AiInsightRepository.fail(ref, { error: 'The AI returned an empty answer.', facts, prompt, aiCallId: result.data.callId })
    return 'FAILED'
  }
  if (result.retryable && !options.lastAttempt) return 'RETRY'
  await AiInsightRepository.fail(ref, { error: result.error, facts, prompt, aiCallId: result.callId })
  return 'FAILED'
}

async function giveUp(position: string, error: string): Promise<void> {
  await AiInsightRepository.fail(reference(position), { error })
}

export const DemandForecastService = {
  options,
  forecast,
  request,
  explain,
  giveUp,
}
