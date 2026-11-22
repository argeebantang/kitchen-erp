import { AiFeature, AiInsightStatus, AiInsightType, Prisma, type ProductionStatus } from '@prisma/client'
import { addDays, businessDayRange, shortDateLabel, todayIsoDate } from '@/lib/dates'
import { trimDecimal } from '@/lib/format'
import { AI_JOB_OPTIONS, REORDER_EXPLAIN, getAiQueue, type ReorderJob } from '@/lib/queue'
import { AiInsightRepository, type AiInsightReference } from '@/repositories/ai-insight.repository'
import { BranchRepository } from '@/repositories/branch.repository'
import { ReorderRepository, type OpenPurchaseLine } from '@/repositories/reorder.repository'
import { AiService, toInsightDto, type AiInsightDto } from '@/services/ai.service'
import { InventoryService, reorderAlerts, type ReorderAlertDto } from '@/services/inventory.service'
import { ProductionOrderService, type ScheduledUse } from '@/services/production-order.service'
import { SupplierService, type SupplierLeadTime } from '@/services/supplier.service'
import { SupplierPerformanceService, lastCompleteMonth } from '@/services/supplier-performance.service'

/**
 * FEATURE 4 — Reorder Recommender (Week 10 Task 4,
 * docs/2026-11-23-week10-reorder-recommender.md). For a material at or below
 * its reorder point at a kitchen, the code works out how much to order and by
 * when (P1); Claude explains it, on request. Shown in the stock map's popup,
 * with a button that opens a pre-filled purchase request (P8).
 *
 *   daily use     = what left the kitchen's stock in the last USAGE_DAYS ÷ USAGE_DAYS
 *   horizon       = lead time + REORDER_COVER_DAYS
 *   expected use  = summed day by day: the larger of the daily use and that
 *                   day's scheduled runs (overdue runs count on today)
 *   order         = expected use over the horizon + reorder point (the safety
 *                   stock) − on hand − already on order for this kitchen,
 *                   rounded up to a whole unit
 *   runs out      = the first day expected use passes what is on hand
 *   order by      = runs out − lead time (today, and how many days late, if
 *                   that has passed)
 */

export const USAGE_DAYS = 30
export const REORDER_COVER_DAYS = 7

/** May ask for or regenerate the explanation: those who order and those who cook. */
export const REORDER_GENERATE_ROLES = ['ADMIN', 'PROCUREMENT_MANAGER', 'PRODUCTION_MANAGER']

/** May open the pre-filled purchase request — the roles middleware lets onto /procurement. */
export const PURCHASE_REQUEST_ROLES = ['ADMIN', 'PROCUREMENT_MANAGER', 'BRANCH_MANAGER', 'PRODUCTION_MANAGER', 'ACCOUNTING']

const REFERENCE_TYPE = 'StockPosition'
const ZERO = new Prisma.Decimal(0)

export type ReorderScheduledRunDto = {
  orderId: string
  orderNumber: string
  /** YYYY-MM-DD. */
  plannedDate: string
  status: ProductionStatus
  finishedGoodName: string
  quantity: string
  /** Planned before today and not yet signed off: its ingredients are still on the shelf. */
  overdue: boolean
}

export type ReorderPurchaseLineDto = {
  kind: 'PR' | 'PO'
  documentId: string
  number: string
  status: string
  quantity: string
  /** YYYY-MM-DD: promised delivery or needed-by. */
  expected: string | null
}

/** How the supplier did in the last month that ended (Feature 6's figures). */
export type ReorderSupplierMonthDto = {
  month: string
  deliveries: number
  shortDeliveries: number
  ordersDelivered: number
  ordersLate: number
  /** The rule's flags in words; empty when not flagged. */
  flagReasons: string[]
}

export type ReorderRecommendationDto = {
  /** '<branchId>:<materialId>' — the insight's referenceId. */
  position: string
  branchId: string
  branchName: string
  materialId: string
  materialName: string
  unit: string
  /** YYYY-MM-DD: the day the figures are for. */
  today: string
  onHand: string
  reorderPoint: string
  usageDays: number
  usedInPeriod: string
  /** usedInPeriod ÷ usageDays, to 3 decimals — the figure every later step uses. */
  dailyUse: string
  /** Runs at this kitchen up to the horizon that will take this material, overdue ones first. */
  scheduled: ReorderScheduledRunDto[]
  scheduledTotal: string
  /** Open requests and orders naming this kitchen: counted. */
  onOrder: ReorderPurchaseLineDto[]
  onOrderTotal: string
  /** Open requests and orders for this material naming no kitchen: shown, not counted. */
  unassigned: ReorderPurchaseLineDto[]
  unassignedTotal: string
  supplier: { id: string; name: string; from: 'order' | 'price' } | null
  supplierLastMonth: ReorderSupplierMonthDto | null
  leadTime: SupplierLeadTime
  coverDays: number
  horizonDays: number
  /** Use expected over the horizon: per day, the daily average or that day's scheduled runs, whichever is more. */
  expectedUse: string
  /** On how many of those days the scheduled runs need more than the average (and so set the day's use). */
  scheduleDays: number
  /** Whole units; '0' when what is on hand and on order covers the horizon. */
  recommendedQty: string
  orderNeeded: boolean
  /** YYYY-MM-DD: the first day it is expected to run short; null if not within the horizon. */
  runOutDate: string | null
  /** YYYY-MM-DD: the last day to order for it to arrive in time — today when that has passed. */
  orderBy: string
  /** Days it arrives after it runs out, even if ordered today; 0 when in time. */
  lateByDays: number
  /** YYYY-MM-DD: what the purchase request asks for. */
  neededBy: string
  insight: AiInsightDto | null
  /** The explanation was written from different figures (on hand, on order, the order or its date). */
  figuresChanged: boolean
}

export type ReorderResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status: number }

export function positionKey(branchId: string, materialId: string): string {
  return `${branchId}:${materialId}`
}

function parsePosition(position: string): { branchId: string; materialId: string } | null {
  const match = /^([A-Za-z0-9_-]{1,40}):([A-Za-z0-9_-]{1,40})$/.exec(position)
  return match ? { branchId: match[1], materialId: match[2] } : null
}

function reference(position: string): AiInsightReference {
  return { type: AiInsightType.REORDER_RECOMMENDATION, referenceType: REFERENCE_TYPE, referenceId: position }
}

/** Decimal to a plain string, at most 3 decimals, no trailing zeros. */
function qty(value: Prisma.Decimal): string {
  return trimDecimal(value.toDecimalPlaces(3).toFixed(3))
}

/**
 * The kitchen an open request or order is for. Purchase requests have no
 * "deliver to" yet, so the kitchen is read from the notes ("For Las Piñas
 * Commissary — …", "Reorder for Main Commissary — KitchenAI"): exactly one
 * kitchen named, or none.
 */
function kitchenNamed(line: OpenPurchaseLine, kitchens: { id: string; name: string }[]): string | null {
  const text = line.notes.join(' ').toLowerCase()
  const named = kitchens.filter(kitchen => text.includes(kitchen.name.toLowerCase()))
  return named.length === 1 ? named[0].id : null
}

function lineDto(line: OpenPurchaseLine): ReorderPurchaseLineDto {
  return {
    kind: line.kind, documentId: line.documentId, number: line.number, status: line.status,
    quantity: qty(line.quantity), expected: line.expected,
  }
}

/** What the explanation's check compares: if any of these moved, the text may no longer fit. */
function checkOf(rec: Pick<ReorderRecommendationDto, 'onHand' | 'onOrderTotal' | 'recommendedQty' | 'orderBy'>) {
  return { onHand: rec.onHand, onOrderTotal: rec.onOrderTotal, recommendedQty: rec.recommendedQty, orderBy: rec.orderBy }
}

function figuresMoved(facts: Prisma.JsonValue | null, rec: ReorderRecommendationDto): boolean {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) return false
  const stored = (facts as Record<string, unknown>).check
  return JSON.stringify(stored) !== JSON.stringify(checkOf(rec))
}

type Inputs = {
  today: string
  kitchens: { id: string; name: string }[]
  used: Map<string, Prisma.Decimal>
  scheduled: ScheduledUse[]
  open: OpenPurchaseLine[]
  suppliers: Awaited<ReturnType<typeof ReorderRepository.suppliers>>
  leadTimes: Map<string, SupplierLeadTime>
  supplierMonth: { month: string; rows: Map<string, ReorderSupplierMonthDto> }
}

/** The numbers for one tile, from inputs read once for all of them. Pure: no reads, no clock. */
function recommend(alert: ReorderAlertDto, inputs: Inputs): Omit<ReorderRecommendationDto, 'insight' | 'figuresChanged'> {
  const { today } = inputs
  const position = positionKey(alert.branchId, alert.materialId)
  const onHand = new Prisma.Decimal(alert.quantity)
  const reorderPoint = new Prisma.Decimal(alert.reorderPoint)
  const usedInPeriod = inputs.used.get(position) ?? ZERO
  const dailyUse = usedInPeriod.div(USAGE_DAYS).toDecimalPlaces(3)

  const supplier = inputs.suppliers.get(alert.materialId) ?? null
  const leadTime = (supplier && inputs.leadTimes.get(supplier.supplierId)) ?? SupplierService.defaultLeadTime()
  const horizonDays = leadTime.days + REORDER_COVER_DAYS
  const horizonEnd = addDays(today, horizonDays - 1)

  const runs = inputs.scheduled
    .filter(run => run.branchId === alert.branchId && run.materialId === alert.materialId && run.plannedDate <= horizonEnd)
  // What the runs of one day need; overdue runs count on today — they are still to be cooked.
  const scheduledOn = (date: string) => runs
    .filter(run => (date === today ? run.plannedDate <= today : run.plannedDate === date))
    .reduce((total, run) => total.add(run.quantity), ZERO)

  // Day by day through the horizon: each day uses the daily average, or that
  // day's scheduled runs when they need more — so a one-off big run adds to
  // the ordinary days instead of disappearing into the average.
  let runOutIndex: number | null = onHand.lte(0) ? 0 : null
  let expectedUse = ZERO
  let scheduleDays = 0
  for (let day = 0; day < horizonDays; day++) {
    const scheduled = scheduledOn(addDays(today, day))
    if (scheduled.gt(dailyUse)) scheduleDays += 1
    expectedUse = expectedUse.add(Prisma.Decimal.max(dailyUse, scheduled))
    if (runOutIndex === null && onHand.sub(expectedUse).lt(0)) runOutIndex = day
  }

  const lines = inputs.open.filter(line => line.materialId === alert.materialId)
  const mine = lines.filter(line => kitchenNamed(line, inputs.kitchens) === alert.branchId)
  const unassigned = lines.filter(line => kitchenNamed(line, inputs.kitchens) === null)
  const sum = (rows: OpenPurchaseLine[]) => rows.reduce((total, line) => total.add(line.quantity), ZERO)
  const onOrderTotal = sum(mine)

  const needed = expectedUse.add(reorderPoint).sub(onHand).sub(onOrderTotal)
  const recommended = needed.gt(0) ? Prisma.Decimal.max(needed.ceil(), 1) : ZERO

  const orderByIndex = runOutIndex === null ? REORDER_COVER_DAYS : runOutIndex - leadTime.days
  const runOutDate = runOutIndex === null ? null : addDays(today, runOutIndex)

  return {
    position,
    branchId:     alert.branchId,
    branchName:   alert.branchName,
    materialId:   alert.materialId,
    materialName: alert.materialName,
    unit:         alert.unitAbbreviation,
    today,
    onHand:       qty(onHand),
    reorderPoint: qty(reorderPoint),
    usageDays:    USAGE_DAYS,
    usedInPeriod: qty(usedInPeriod),
    dailyUse:     qty(dailyUse),
    scheduled: runs.map(run => ({
      orderId: run.orderId, orderNumber: run.orderNumber, plannedDate: run.plannedDate, status: run.status,
      finishedGoodName: run.finishedGoodName, quantity: qty(run.quantity), overdue: run.plannedDate < today,
    })),
    scheduledTotal:  qty(runs.reduce((total, run) => total.add(run.quantity), ZERO)),
    onOrder:         mine.map(lineDto),
    onOrderTotal:    qty(onOrderTotal),
    unassigned:      unassigned.map(lineDto),
    unassignedTotal: qty(sum(unassigned)),
    supplier:        supplier && { id: supplier.supplierId, name: supplier.supplierName, from: supplier.from },
    supplierLastMonth: (supplier && inputs.supplierMonth.rows.get(supplier.supplierName)) ?? null,
    leadTime,
    coverDays:       REORDER_COVER_DAYS,
    horizonDays,
    expectedUse:     qty(expectedUse),
    scheduleDays,
    recommendedQty:  qty(recommended),
    orderNeeded:     recommended.gt(0),
    runOutDate,
    orderBy:         addDays(today, Math.max(orderByIndex, 0)),
    lateByDays:      Math.max(-orderByIndex, 0),
    neededBy:        runOutDate ?? addDays(today, horizonDays),
  }
}

/** Everything the tiles need, read once: usage, the schedule, open purchases, suppliers and lead times. */
async function inputsFor(alerts: ReorderAlertDto[]): Promise<Inputs> {
  const today = todayIsoDate()
  const branchIds = [...new Set(alerts.map(alert => alert.branchId))]
  const materialIds = [...new Set(alerts.map(alert => alert.materialId))]
  const window = { start: businessDayRange(addDays(today, -USAGE_DAYS)).start, end: businessDayRange(today).start }
  const month = lastCompleteMonth(today)

  const [kitchens, usage, open, suppliers, leadTimes, monthFacts] = await Promise.all([
    BranchRepository.findActiveKitchens(),
    ReorderRepository.usage(branchIds, materialIds, window),
    ReorderRepository.openPurchaseLines(materialIds),
    ReorderRepository.suppliers(materialIds),
    SupplierService.leadTimes(),
    SupplierPerformanceService.facts(month),
  ])
  // The longest horizon any tile can have, so one read of the schedule serves them all.
  const longest = Math.max(...[...leadTimes.values()].map(lead => lead.days), SupplierService.defaultLeadTime().days)
  const scheduled = await ProductionOrderService.scheduledUse(branchIds, addDays(today, longest + REORDER_COVER_DAYS - 1))

  return {
    today,
    kitchens,
    used: new Map(usage.map(row => [positionKey(row.branchId, row.materialId), row.used])),
    scheduled,
    open,
    suppliers,
    leadTimes,
    supplierMonth: {
      month,
      rows: new Map((monthFacts?.suppliers ?? []).map(row => [row.supplier, {
        month, deliveries: row.deliveries, shortDeliveries: row.shortDeliveries,
        ordersDelivered: row.ordersDelivered, ordersLate: row.ordersLate, flagReasons: row.flagReasons,
      }])),
    },
  }
}

/**
 * Recommendations for every 🔴/🟡 tile among these (the stock map's alerts),
 * keyed by position, each with its stored explanation. Kitchens only: the
 * stock map shows no outlet materials (Task 4 fix).
 */
async function forAlerts(alerts: ReorderAlertDto[]): Promise<Record<string, ReorderRecommendationDto>> {
  if (alerts.length === 0) return {}
  const [inputs, insights] = await Promise.all([
    inputsFor(alerts),
    AiInsightRepository.findMany(
      AiInsightType.REORDER_RECOMMENDATION, REFERENCE_TYPE,
      alerts.map(alert => positionKey(alert.branchId, alert.materialId)),
    ),
  ])
  const insightOf = new Map(insights.map(row => [row.referenceId, row]))
  return Object.fromEntries(alerts.map(alert => {
    const base = recommend(alert, inputs)
    const stored = insightOf.get(base.position)
    const rec: ReorderRecommendationDto = { ...base, insight: stored ? toInsightDto(stored) : null, figuresChanged: false }
    rec.figuresChanged = stored?.status === AiInsightStatus.READY && figuresMoved(stored.facts, rec)
    return [base.position, rec]
  }))
}

/** One position's recommendation, live; null unless it is a kitchen material at or below its reorder point. */
async function forPosition(position: string): Promise<ReorderRecommendationDto | null> {
  const parsed = parsePosition(position)
  if (!parsed) return null
  const branches = await InventoryService.stockMap({ branchId: parsed.branchId })
  const alert = reorderAlerts(branches).find(row => row.materialId === parsed.materialId)
  if (!alert) return null
  return (await forAlerts([alert]))[position] ?? null
}

/**
 * The purchase request pre-fill (P8): the recommended quantity, needed by the
 * day it runs out, and a note naming the kitchen — which is also how a later
 * recommendation knows this request is on order for it. Null when there is
 * nothing to order; the page then shows the empty form.
 */
async function purchaseRequestPrefill(position: string) {
  const rec = await forPosition(position)
  if (!rec || !rec.orderNeeded) return null
  return {
    recommendation: rec,
    neededBy: rec.neededBy < rec.today ? rec.today : rec.neededBy,
    notes:    `Reorder for ${rec.branchName} — KitchenAI: ${rec.recommendedQty} ${rec.unit} ${rec.materialName}, order by ${shortDateLabel(rec.orderBy)}`,
    lines:    [{ materialId: rec.materialId, quantity: rec.recommendedQty }],
  }
}

/** "Tue, Nov 24" — dates as the popup reads, so the explanation quotes them the same way. */
function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** What Claude is given — the recommendation as the popup shows it. Stored on the insight. */
function explanationFacts(rec: ReorderRecommendationDto) {
  const unit = rec.unit
  return {
    kitchen:       rec.branchName,
    material:      rec.materialName,
    unit,
    today:         dayLabel(rec.today),
    status:        Number(rec.onHand) <= 0 ? 'out of stock' : 'at or below its reorder point',
    onHand:        `${rec.onHand} ${unit}`,
    reorderPoint:  `${rec.reorderPoint} ${unit} (kept as safety stock)`,
    usedInLast30Days: `${rec.usedInPeriod} ${unit}`,
    dailyUse:      `${rec.dailyUse} ${unit} a day`,
    supplier:      rec.supplier?.name ?? 'none on record',
    leadTime: {
      days:     rec.leadTime.days,
      source:   rec.leadTime.source === 'measured'
        ? `measured: median over ${rec.leadTime.measuredOrders} orders in the last 180 days`
        : rec.leadTime.source === 'promised' ? 'promised by the supplier' : 'default — no measurement or promise on record',
      promisedDays: rec.leadTime.promisedDays,
    },
    supplierLastMonth: rec.supplierLastMonth && {
      month:           rec.supplierLastMonth.month,
      shortDeliveries: `${rec.supplierLastMonth.shortDeliveries} of ${rec.supplierLastMonth.deliveries}`,
      lateOrders:      `${rec.supplierLastMonth.ordersLate} of ${rec.supplierLastMonth.ordersDelivered}`,
      flagged:         rec.supplierLastMonth.flagReasons,
    },
    coverDays:     rec.coverDays,
    horizonDays:   `${rec.horizonDays} (lead time ${rec.leadTime.days} + cover ${rec.coverDays})`,
    scheduledRuns: rec.scheduled.map(run => ({
      order: run.orderNumber, date: dayLabel(run.plannedDate), product: run.finishedGoodName,
      needs: `${run.quantity} ${unit}`, overdue: run.overdue,
    })),
    expectedUseOverHorizon: `${rec.expectedUse} ${unit}`,
    expectedUseMadeOf: rec.scheduleDays === 0
      ? `the daily average on all ${rec.horizonDays} days`
      : `the scheduled runs on ${rec.scheduleDays} ${rec.scheduleDays === 1 ? 'day' : 'days'} where they need more than the daily average, the daily average on the other ${rec.horizonDays - rec.scheduleDays}`,
    onOrderForThisKitchen: rec.onOrder.map(line => `${line.number} (${line.status}): ${line.quantity} ${unit}`),
    onOrderTotal:  `${rec.onOrderTotal} ${unit}`,
    openWithNoKitchenNamed: rec.unassigned.length > 0
      ? `${rec.unassignedTotal} ${unit} on ${rec.unassigned.map(line => line.number).join(', ')} — not counted`
      : null,
    recommendedOrder: rec.orderNeeded ? `${rec.recommendedQty} ${unit}` : 'none: on hand and on order cover the horizon',
    runsShortOn:   rec.runOutDate ? dayLabel(rec.runOutDate) : `not within ${rec.horizonDays} days`,
    orderBy:       rec.orderBy === rec.today ? `${dayLabel(rec.orderBy)} (today)` : dayLabel(rec.orderBy),
    arrivesLateByDays: rec.lateByDays,
    check:         checkOf(rec),
  }
}

const INSTRUCTIONS = `You explain one stock reorder recommendation to the kitchen and purchasing team of Lydia's Lechon. The system has already worked out every figure: quote them as given; do not recalculate, re-round or add figures of your own.

Write 3 to 5 sentences, under 120 words, in plain text with no headings, lists or Markdown.
- Start with the recommendation: how much to order and by when, or that no order is needed.
- Say why in figures: the daily use, the lead time and where it comes from, the cover days, the safety stock (reorder point), scheduled runs if they drive it, and what is already on order.
- If even an order today arrives after it runs out, say so plainly and by how many days.
- Mention a risk only if the figures show it: the supplier flagged short or late last month (then suggest ordering early or a little extra), runs that are overdue, or open requests that name no kitchen and so were not counted.
Do not suggest causes the figures do not show.`

async function request(position: string, requestedById: string | null, options: { regenerate?: boolean } = {}): Promise<ReorderResult<{ queued: boolean }>> {
  if (!parsePosition(position)) return { success: false, error: 'Unknown stock position', status: 400 }
  const rec = await forPosition(position)
  if (!rec) {
    return { success: false, error: 'Only a kitchen material at or below its reorder point gets a reorder recommendation', status: 409 }
  }
  const ref = reference(position)
  const asked = options.regenerate ? await AiInsightRepository.regenerate(ref) : await AiInsightRepository.request(ref)
  if (!asked) return { success: true, data: { queued: false } }
  try {
    await getAiQueue().add(REORDER_EXPLAIN, { position, requestedById } satisfies ReorderJob, AI_JOB_OPTIONS)
  } catch (err) {
    console.error('[ReorderService] could not queue the explanation', err)
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

  const rec = await forPosition(position)
  if (!rec) {
    await AiInsightRepository.fail(ref, { error: 'This material is no longer at or below its reorder point here.' })
    return 'FAILED'
  }

  const facts  = explanationFacts(rec)
  const prompt = `Explain the reorder recommendation for ${rec.materialName} at ${rec.branchName}.\n\n<figures>\n${JSON.stringify(facts, null, 2)}\n</figures>`
  const result = await AiService.complete({
    feature:      AiFeature.REORDER_RECOMMENDATION,
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

export const ReorderService = {
  forAlerts,
  forPosition,
  purchaseRequestPrefill,
  request,
  explain,
  giveUp,
}
