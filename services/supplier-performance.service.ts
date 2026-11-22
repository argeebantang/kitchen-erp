import { AiFeature, AiInsightStatus, AiInsightType, Prisma } from '@prisma/client'
import { addMonths, businessDayRange, MONTH_PATTERN, todayIsoDate } from '@/lib/dates'
import { AI_JOB_OPTIONS, getAiQueue, SUPPLIER_PERFORMANCE_REPORT, type SupplierPerformanceJob } from '@/lib/queue'
import { AiInsightRepository, type AiInsightReference } from '@/repositories/ai-insight.repository'
import { SupplierReportRepository, type MonthWindow } from '@/repositories/supplier-report.repository'
import { SupplierRepository } from '@/repositories/supplier.repository'
import { AiService, toInsightDto, type AiInsightDto } from '@/services/ai.service'
import { findingsAbout, findingsSchema, keepKnownFindings, parseFindings, type AiFindingsReport } from '@/services/ai-findings'

/**
 * FEATURE 6 — Supplier Performance Analyzer (Week 10 Task 3,
 * docs/2026-11-23-week10-supplier-performance.md).
 *
 * Once a month, every supplier's deliveries of the month before: what came
 * short and what it was worth, what was rejected, how often orders arrived
 * after the promised date, the lead time it really delivers in against the
 * one it promises, and orders still not filled. The code works out every
 * figure and applies the flag rule; Claude explains who is reliable and who
 * is not, and what procurement should do — findings tied to the rows (S1, M1).
 *
 * One report per calendar month: insight (SUPPLIER_PERFORMANCE, 'Month', '2026-10').
 */

/** Who sees the report on the dashboard (owner, 2026-11-21). Who may generate it is in AiInsightService. */
export const SUPPLIER_REPORT_ROLES = ['ADMIN', 'ACCOUNTING', 'PROCUREMENT_MANAGER', 'VIEWER']

/**
 * The flag rule (Week 10 Task 3, replacing the plan's "3+ deliveries or 25 %+
 * of lines", which flagged every supplier on the history's volumes): a
 * supplier is flagged for short deliveries when at least FLAG_MIN_COUNT of
 * its deliveries in the month came short AND they are at least FLAG_MIN_PCT %
 * of its deliveries; for lateness, the same on its orders.
 */
export const FLAG_MIN_COUNT = 3
export const FLAG_MIN_PCT = 25
export const MAX_FINDINGS = 5
/** Material rows given to Claude and listed on the card, the most often short first. */
export const MATERIAL_ROWS = 10

export type SupplierFact = {
  id: string
  supplier: string
  deliveries: number
  orders: number
  receivedValue: string
  lines: number
  shortLines: number
  shortLinePct: string | null
  shortDeliveries: number
  shortDeliveryPct: string | null
  /** What did not come: (expected − received) × the line's cost. */
  shortValue: string
  rejectedLines: number
  rejectedValue: string
  /** Orders first delivered this month, and how many after the promised date. */
  ordersDelivered: number
  ordersLate: number
  lateOrderPct: string | null
  avgDaysLate: string | null
  maxDaysLate: number | null
  promisedLeadTimeDays: number | null
  measuredLeadTimeDays: number | null
  /** Of the orders first delivered this month, those still missing part of the order. */
  unfilledOrders: number
  unfilledValue: string
  flags: ('short' | 'late')[]
  /** The rule's reasons in words, e.g. "short on 13 of 33 deliveries (39.4%)". */
  flagReasons: string[]
}

export type SupplierMaterialFact = {
  id: string
  supplier: string
  material: string
  unit: string
  lines: number
  shortLines: number
  shortLinePct: string | null
  shortQty: string
  shortValue: string
}

export type SupplierFacts = {
  month: string
  /** Inclusive. */
  from: string
  to: string
  currency: 'PHP'
  flagRule: string
  totals: {
    suppliers: number
    deliveries: number
    receivedValue: string
    shortValue: string
    rejectedValue: string
    unfilledValue: string
    flaggedSuppliers: number
  }
  suppliers: SupplierFact[]
  materials: SupplierMaterialFact[]
}

const zero = new Prisma.Decimal(0)
const php = (value: Prisma.Decimal | null) => (value ?? zero).toDecimalPlaces(2).toFixed(2)
const pct = (part: number, whole: number) => (whole === 0 ? null : new Prisma.Decimal(part).div(whole).mul(100).toDecimalPlaces(1).toFixed(1))
const reaches = (count: number, whole: number) => count >= FLAG_MIN_COUNT && whole > 0 && new Prisma.Decimal(count).div(whole).mul(100).greaterThanOrEqualTo(FLAG_MIN_PCT)

/** A calendar month as instants (Manila), and its first and last day. Null for a malformed key. */
export function monthWindow(month: string): { window: MonthWindow; from: string; to: string } | null {
  if (!MONTH_PATTERN.test(month)) return null
  const next = addMonths(month, 1)
  const lastDay = new Date(Date.parse(`${next}-01T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  return {
    window: { start: businessDayRange(`${month}-01`).start, end: businessDayRange(`${next}-01`).start },
    from: `${month}-01`,
    to: lastDay,
  }
}

/** The last month that has ended — what the dashboard shows and the 1st-of-the-month job reports on. */
export function lastCompleteMonth(today = todayIsoDate()): string {
  return addMonths(today.slice(0, 7), -1)
}

async function facts(month: string): Promise<SupplierFacts | null> {
  const span = monthWindow(month)
  if (!span) return null
  const [deliveries, shorts, timeliness, suppliers] = await Promise.all([
    SupplierReportRepository.deliveries(span.window),
    SupplierReportRepository.materialShorts(span.window),
    SupplierReportRepository.timeliness(span.window),
    SupplierRepository.findAll(),
  ])
  const timelinessOf = new Map(timeliness.map(row => [row.supplierId, row]))
  const promisedOf = new Map(suppliers.map(s => [s.id, s.leadTimeDays]))

  const rows: SupplierFact[] = [...deliveries]
    .sort((a, b) => (b.receivedValue ?? zero).comparedTo(a.receivedValue ?? zero))
    .map((row, index) => {
      const t = timelinessOf.get(row.supplierId)
      const deliveryCount = Number(row.deliveries)
      const shortDeliveries = Number(row.shortDeliveries)
      const ordersDelivered = Number(t?.orders ?? 0)
      const ordersLate = Number(t?.late ?? 0)
      const flags: SupplierFact['flags'] = []
      const flagReasons: string[] = []
      if (reaches(shortDeliveries, deliveryCount)) {
        flags.push('short')
        flagReasons.push(`short on ${shortDeliveries} of ${deliveryCount} deliveries (${pct(shortDeliveries, deliveryCount)}%)`)
      }
      if (reaches(ordersLate, ordersDelivered)) {
        flags.push('late')
        flagReasons.push(`late on ${ordersLate} of ${ordersDelivered} orders (${pct(ordersLate, ordersDelivered)}%)`)
      }
      return {
        id: `S${index + 1}`,
        supplier: row.supplierName,
        deliveries: deliveryCount,
        orders: Number(row.orders),
        receivedValue: php(row.receivedValue),
        lines: Number(row.lines),
        shortLines: Number(row.shortLines),
        shortLinePct: pct(Number(row.shortLines), Number(row.lines)),
        shortDeliveries,
        shortDeliveryPct: pct(shortDeliveries, deliveryCount),
        shortValue: php(row.shortValue),
        rejectedLines: Number(row.rejectedLines),
        rejectedValue: php(row.rejectedValue),
        ordersDelivered,
        ordersLate,
        lateOrderPct: pct(ordersLate, ordersDelivered),
        avgDaysLate: t?.avgDaysLate ? t.avgDaysLate.toDecimalPlaces(1).toFixed(1) : null,
        maxDaysLate: t?.maxDaysLate ?? null,
        promisedLeadTimeDays: promisedOf.get(row.supplierId) ?? null,
        measuredLeadTimeDays: t?.medianLeadTime ?? null,
        unfilledOrders: Number(t?.unfilledOrders ?? 0),
        unfilledValue: php(t?.unfilledValue ?? null),
        flags,
        flagReasons,
      }
    })

  const materials: SupplierMaterialFact[] = [...shorts]
    .sort((a, b) => Number(b.shortLines) - Number(a.shortLines) || (b.shortValue ?? zero).comparedTo(a.shortValue ?? zero))
    .slice(0, MATERIAL_ROWS)
    .map((row, index) => ({
      id: `M${index + 1}`,
      supplier: row.supplierName,
      material: row.materialName,
      unit: row.unit,
      lines: Number(row.lines),
      shortLines: Number(row.shortLines),
      shortLinePct: pct(Number(row.shortLines), Number(row.lines)),
      shortQty: (row.shortQty ?? zero).toDecimalPlaces(2).toFixed(2),
      shortValue: php(row.shortValue),
    }))

  const sum = (pick: (row: (typeof deliveries)[number]) => Prisma.Decimal | null) => deliveries.reduce((total, row) => total.add(pick(row) ?? zero), zero)
  return {
    month, from: span.from, to: span.to, currency: 'PHP',
    flagRule: `Flagged when at least ${FLAG_MIN_COUNT} deliveries came short and they are at least ${FLAG_MIN_PCT}% of the month's deliveries; the same for orders arriving after the promised date.`,
    totals: {
      suppliers: rows.length,
      deliveries: rows.reduce((n, row) => n + row.deliveries, 0),
      receivedValue: php(sum(row => row.receivedValue)),
      shortValue: php(sum(row => row.shortValue)),
      rejectedValue: php(sum(row => row.rejectedValue)),
      unfilledValue: php(timeliness.reduce((total, row) => total.add(row.unfilledValue ?? zero), zero)),
      flaggedSuppliers: rows.filter(row => row.flags.length > 0).length,
    },
    suppliers: rows,
    materials,
  }
}

// ─── Claude's findings ────────────────────────────────────────────────────────

const REPORT_SCHEMA = findingsSchema({
  summary:   'Two sentences: which suppliers are flagged and why, and how the rest did.',
  findings:  `At most ${MAX_FINDINGS}, the most serious first.`,
  figureIds: 'Ids of the rows it rests on, e.g. ["S2"] or ["S2", "M1"].',
  title:     'The supplier, and the problem in a few words.',
})

const INSTRUCTIONS = `You review one month of deliveries from Lydia's Lechon's suppliers and say which ones the business can rely on.

The figures are in <figures>, worked out by the system. Each row has an id:
- S rows: one supplier's month — deliveries and orders, what was received (₱), lines that came short and what was missing (₱), lines partly rejected, orders that arrived after the promised date and by how many days, the lead time it promises against the one it delivered in, orders still not filled, and the flags the system set with its reasons.
- M rows: one supplier's material that came short — on how many of its lines, how much and what it was worth.

The flag rule is in "flagRule". The system has already applied it; repeat its flags, do not invent others.

Write at most ${MAX_FINDINGS} findings, the most serious first: a flagged supplier, a material that keeps coming short, a supplier often late against what it promises, orders left unfilled, a lot rejected. A reliable supplier is worth one short finding saying so.

For each finding:
- figureIds: the ids of the rows it rests on.
- title: the supplier, and the problem in a few words.
- pattern: what happened this month, in one or two sentences, quoting the figures exactly as given.
- recommendation: one concrete thing procurement does next month (talk to the supplier about a specific material, order earlier by the measured lead time, split an item to another supplier, check deliveries on arrival). If it involves a number, use one of the given figures, never one you worked out.
- priority: high, medium or low.

summary: two sentences — which suppliers are flagged and why, and how the others did.

Never calculate: no sums, differences, percentages or averages of your own. Use only the figures given.`

function reference(month: string): AiInsightReference {
  return { type: AiInsightType.SUPPLIER_PERFORMANCE, referenceType: 'Month', referenceId: month }
}

export type SupplierReportResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status: number }

/** Generate / Regenerate / the monthly job. Only a month that has ended. */
async function request(month: string, requestedById: string | null, options: { regenerate?: boolean } = {}): Promise<SupplierReportResult<{ queued: boolean }>> {
  if (!monthWindow(month)) return { success: false, error: 'Unknown month', status: 400 }
  if (month > lastCompleteMonth()) return { success: false, error: 'That month has not ended yet', status: 400 }

  const ref = reference(month)
  const asked = options.regenerate ? await AiInsightRepository.regenerate(ref) : await AiInsightRepository.request(ref)
  if (!asked) return { success: true, data: { queued: false } }

  try {
    await getAiQueue().add(SUPPLIER_PERFORMANCE_REPORT, { month, requestedById } satisfies SupplierPerformanceJob, AI_JOB_OPTIONS)
  } catch (err) {
    console.error('[SupplierPerformanceService] could not queue the report', err)
    await AiInsightRepository.fail(ref, { error: 'Could not queue the report (the job queue is unavailable). Try again.' })
  }
  return { success: true, data: { queued: true } }
}

export type WriteOutcome = 'READY' | 'FAILED' | 'RETRY' | 'SKIPPED'

/** Writes a PENDING report (the job). A month with no deliveries is written without calling Claude. */
async function write(month: string, options: { userId: string | null; lastAttempt: boolean }): Promise<WriteOutcome> {
  const ref = reference(month)
  const current = await AiInsightRepository.find(ref)
  if (current?.status !== AiInsightStatus.PENDING) return 'SKIPPED'

  const figures = await facts(month)
  if (!figures) {
    await AiInsightRepository.fail(ref, { error: 'Unknown month.' })
    return 'FAILED'
  }
  const factsJson = figures as unknown as Prisma.InputJsonValue

  if (figures.suppliers.length === 0) {
    const quiet: AiFindingsReport = { summary: `No deliveries were received from ${figures.from} to ${figures.to}.`, findings: [] }
    await AiInsightRepository.complete(ref, { content: JSON.stringify(quiet), facts: factsJson, prompt: '', model: 'none', aiCallId: null })
    return 'READY'
  }

  const prompt = `Review the suppliers' deliveries from ${figures.from} to ${figures.to}.\n\n<figures>\n${JSON.stringify(figures, null, 2)}\n</figures>`
  const result = await AiService.complete({
    feature:      AiFeature.SUPPLIER_PERFORMANCE,
    instructions: INSTRUCTIONS,
    messages:     [{ role: 'user', content: prompt }],
    userId:       options.userId,
    format:       { type: 'json_schema', schema: REPORT_SCHEMA },
  })

  if (!result.success) {
    if (result.retryable && !options.lastAttempt) return 'RETRY'
    await AiInsightRepository.fail(ref, { error: result.error, facts: factsJson, prompt, aiCallId: result.callId })
    return 'FAILED'
  }
  const report = parseFindings(result.data.text)
  if (!report) {
    await AiInsightRepository.fail(ref, { error: 'The AI returned a report that could not be read.', facts: factsJson, prompt, aiCallId: result.data.callId })
    return 'FAILED'
  }
  const ids = new Set([...figures.suppliers, ...figures.materials].map(row => row.id))
  await AiInsightRepository.complete(ref, {
    content: JSON.stringify(keepKnownFindings(report, ids, MAX_FINDINGS)),
    facts: factsJson, prompt, model: result.data.servedModel, aiCallId: result.data.callId,
  })
  return 'READY'
}

async function giveUp(month: string, error: string): Promise<void> {
  await AiInsightRepository.fail(reference(month), { error })
}

export type SupplierDashboardDto = {
  month: string
  /** Months a viewer can pick: the last six that have ended, the newest first. */
  monthOptions: string[]
  facts: SupplierFacts
  insight: AiInsightDto | null
  /** With a supplier chosen, only the findings that cite its rows. */
  report: AiFindingsReport | null
  totalFindings: number
  /** The supplier the card is narrowed to (its S row id), or null for all. */
  supplier: { id: string; name: string } | null
  /** Every supplier with deliveries that month, for the filter. */
  supplierOptions: string[]
}

/** The dashboard card: a month that has ended (the last by default), optionally narrowed to one supplier by name. */
async function dashboard(options: { month?: string; supplier?: string } = {}): Promise<SupplierDashboardDto> {
  const last = lastCompleteMonth()
  const monthOptions = Array.from({ length: 6 }, (_, i) => addMonths(last, -i))
  const month = options.month && monthOptions.includes(options.month) ? options.month : last
  const [figures, row] = await Promise.all([facts(month), AiInsightRepository.find(reference(month))])
  const insight = row ? toInsightDto(row) : null
  const report  = parseFindings(insight?.content ?? null)
  const all = figures!
  const supplierOptions = all.suppliers.map(s => s.supplier)
  const chosen = all.suppliers.find(s => s.supplier === options.supplier)
  if (!chosen) {
    return { month, monthOptions, facts: all, insight, report, totalFindings: report?.findings.length ?? 0, supplier: null, supplierOptions }
  }
  const scoped: SupplierFacts = {
    ...all,
    suppliers: [chosen],
    materials: all.materials.filter(m => m.supplier === chosen.supplier),
  }
  const ids = new Set([...scoped.suppliers, ...scoped.materials].map(r => r.id))
  return {
    month, monthOptions, facts: scoped, insight,
    report: report ? findingsAbout(report, ids) : null,
    totalFindings: report?.findings.length ?? 0,
    supplier: { id: chosen.id, name: chosen.supplier },
    supplierOptions,
  }
}

export const SupplierPerformanceService = {
  facts,
  request,
  write,
  giveUp,
  dashboard,
}
