import { AiFeature, AiInsightStatus, AiInsightType, Prisma } from '@prisma/client'
import { z } from 'zod'
import { addDays, businessDayRange, isoWeekKey, todayIsoDate, weekKeyStart } from '@/lib/dates'
import { AI_JOB_OPTIONS, getAiQueue, WASTE_PATTERN_REPORT, type WastePatternJob } from '@/lib/queue'
import { AiInsightRepository, type AiInsightReference } from '@/repositories/ai-insight.repository'
import { WasteReportRepository, type WasteWindow } from '@/repositories/waste-report.repository'
import { AiService, toInsightDto, type AiInsightDto } from '@/services/ai.service'

/**
 * FEATURE 3 — Waste Pattern Detector (Week 10 Task 2,
 * docs/2026-11-23-week10-waste-pattern-detector.md).
 *
 * Once a week, the last 30 days of waste — write-offs and losses in transit,
 * with returns and conversions as what was recovered — per branch and
 * finished good. The code works out every figure (Decimal, P1); Claude finds
 * the patterns among them and recommends what to do, as structured findings
 * that each name the figures they rest on, so the page can show those
 * figures beside them.
 *
 * One report per ISO week (P3): insight (WASTE_PATTERN, 'Week', '2026-W48'),
 * covering the 30 days before that week's Monday.
 */

/** Who sees the report on the dashboard (owner, 2026-11-21). Who may generate it is in AiInsightService. */
export const WASTE_REPORT_ROLES = ['ADMIN', 'ACCOUNTING', 'PRODUCTION_MANAGER', 'VIEWER']

export const WASTE_WINDOW_DAYS = 30
/** The branch-and-good rows Claude is given and the card lists, the costliest first. */
export const WASTE_ROWS = 12
export const MAX_FINDINGS = 5

// ─── The figures ──────────────────────────────────────────────────────────────

export type WasteRowFact = {
  id: string
  branch: string
  branchType: 'kitchen' | 'outlet'
  good: string
  unit: string
  writtenOffKg: string
  writtenOffValue: string
  writeOffs: number
  daysWithWriteOffs: number
  /** kg per reason: expired, spoiled, damaged, failed quality, other. */
  byReason: Record<string, string>
  /** Delivered in (an outlet) or made (a kitchen). */
  cameInKg: string
  /** Written off as a % of what came in; null when nothing came in. */
  wastePctOfCameIn: string | null
  avgDailyCameInKg: string
  /** Outlets only (Daily Sales). */
  soldKg: string | null
  avgDailySoldKg: string | null
  /** Outlets only: sent back to a kitchen. */
  returnedKg: string | null
  previousWrittenOffKg: string
  /** % change in kg written off against the previous 30 days; null when there was none then. */
  changePct: string | null
}

/** One branch's write-offs, all goods together (all of them, not only the rows below). */
export type WasteBranchFact = {
  id: string
  branch: string
  branchType: 'kitchen' | 'outlet'
  writeOffs: number
  writtenOffKg: string
  writtenOffValue: string
  /** This branch's share of everything written off, by value. */
  sharePctOfWrittenOff: string | null
  /** Delivered in (an outlet) or made (a kitchen), every good. */
  cameInKg: string
  wastePctOfCameIn: string | null
  /** The good it wrote off most of, by value. */
  biggestGood: string
  biggestGoodValue: string
}

export type WasteRouteFact = {
  id: string
  route: string
  deliveries: number
  deliveriesWithLoss: number
  lostKg: string
  lostValue: string
  reasons: string[]
}

export type WasteRecoveredFact = {
  id: string
  kitchen: string
  conversions: number
  convertedKg: string
  from: string
  madeKg: string
  into: string
}

export type WasteFacts = {
  week: string
  /** The 30 days covered, inclusive. */
  from: string
  to: string
  days: number
  currency: 'PHP'
  totals: {
    writtenOffKg: string
    writtenOffValue: string
    lostInTransitValue: string
    /** Written off + lost in transit. */
    lostValue: string
    productionCost: string
    /** lostValue as a % of productionCost; null with no production. */
    lostPctOfProductionCost: string | null
    previousWrittenOffValue: string
    /** % change of the value written off against the previous 30 days. */
    writtenOffChangePct: string | null
  }
  /** Each branch's total, the costliest first (B1…). */
  branches: WasteBranchFact[]
  rows: WasteRowFact[]
  /** Branch-and-good pairs with write-offs not in `rows` (smaller ones). */
  otherRows: number
  routes: WasteRouteFact[]
  recovered: WasteRecoveredFact[]
}

/** Reasons in words, for Claude's text and the card: "failed quality", not FAILED_QUALITY. */
const REASON_WORDS: Record<string, string> = {
  EXPIRED: 'expired', SPOILED: 'spoiled', DAMAGED: 'damaged', FAILED_QUALITY: 'failed quality', MISSING: 'missing', OTHER: 'other',
}
const inWords = (reason: string) => REASON_WORDS[reason] ?? reason.toLowerCase()

const zero = new Prisma.Decimal(0)
const kg  = (value: Prisma.Decimal) => value.toDecimalPlaces(2).toFixed(2)
const php = (value: Prisma.Decimal) => value.toDecimalPlaces(2).toFixed(2)
const pct = (part: Prisma.Decimal, whole: Prisma.Decimal) => (whole.isZero() ? null : part.div(whole).mul(100).toDecimalPlaces(1).toFixed(1))
const change = (now: Prisma.Decimal, before: Prisma.Decimal) => (before.isZero() ? null : now.sub(before).div(before).mul(100).toDecimalPlaces(1).toFixed(1))

/** The 30 days before a week's Monday, and the 30 before those. Null for a malformed key. */
export function windowsFor(week: string): { from: string; to: string; current: WasteWindow; previous: WasteWindow } | null {
  const monday = weekKeyStart(week)
  if (!monday) return null
  const from = addDays(monday, -WASTE_WINDOW_DAYS)
  const previousFrom = addDays(from, -WASTE_WINDOW_DAYS)
  const window = (start: string, end: string): WasteWindow => ({
    start: businessDayRange(start).start, end: businessDayRange(end).start,
    startDate: new Date(`${start}T00:00:00.000Z`), endDate: new Date(`${end}T00:00:00.000Z`),
  })
  return { from, to: addDays(monday, -1), current: window(from, monday), previous: window(previousFrom, from) }
}

async function facts(week: string): Promise<WasteFacts | null> {
  const windows = windowsFor(week)
  if (!windows) return null
  const { current, previous } = windows

  const [writeOffs, writeOffDays, previousWriteOffs, flows, sold, routes, conversions, productionCost] = await Promise.all([
    WasteReportRepository.writeOffs(current),
    WasteReportRepository.writeOffDays(current),
    WasteReportRepository.writeOffs(previous),
    WasteReportRepository.flows(current),
    WasteReportRepository.sold(current),
    WasteReportRepository.routes(current),
    WasteReportRepository.conversions(current),
    WasteReportRepository.productionCost(current),
  ])

  // Per branch and good: the reasons folded together.
  type Pair = { branch: string; branchType: string; good: string; unit: string; kg: Prisma.Decimal; value: Prisma.Decimal; writeOffs: number; days: number; byReason: Map<string, Prisma.Decimal> }
  const pairs = new Map<string, Pair & { branchId: string; finishedGoodId: string }>()
  for (const row of writeOffs) {
    const key = `${row.branchId}:${row.finishedGoodId}`
    const pair = pairs.get(key) ?? {
      branchId: row.branchId, finishedGoodId: row.finishedGoodId, branch: row.branchName, branchType: row.branchType,
      good: row.finishedGoodName, unit: row.unit, kg: zero, value: zero, writeOffs: 0, days: 0, byReason: new Map(),
    }
    pair.kg = pair.kg.add(row.kg)
    pair.value = pair.value.add(row.value)
    pair.writeOffs += Number(row.writeOffs)
    pair.byReason.set(row.reason, (pair.byReason.get(row.reason) ?? zero).add(row.kg))
    pairs.set(key, pair)
  }
  for (const row of writeOffDays) {
    const pair = pairs.get(`${row.branchId}:${row.finishedGoodId}`)
    if (pair) pair.days = Number(row.days)
  }
  const previousKg = new Map<string, Prisma.Decimal>()
  for (const row of previousWriteOffs) {
    const key = `${row.branchId}:${row.finishedGoodId}`
    previousKg.set(key, (previousKg.get(key) ?? zero).add(row.kg))
  }
  const flowOf = new Map(flows.map(row => [`${row.branchId}:${row.finishedGoodId}`, row]))
  const soldOf = new Map(sold.map(row => [`${row.branchId}:${row.finishedGoodId}`, row.kg]))
  const days = new Prisma.Decimal(WASTE_WINDOW_DAYS)

  const sorted = [...pairs.entries()].sort(([, a], [, b]) => b.value.comparedTo(a.value))
  const rows: WasteRowFact[] = sorted.slice(0, WASTE_ROWS).map(([key, pair], index) => {
    const outlet  = pair.branchType === 'OUTLET'
    const cameIn  = flowOf.get(key)?.inKg ?? zero
    const soldKg  = soldOf.get(key) ?? zero
    const before  = previousKg.get(key) ?? zero
    return {
      id: `W${index + 1}`,
      branch: pair.branch,
      branchType: outlet ? 'outlet' : 'kitchen',
      good: pair.good,
      unit: pair.unit,
      writtenOffKg: kg(pair.kg),
      writtenOffValue: php(pair.value),
      writeOffs: pair.writeOffs,
      daysWithWriteOffs: pair.days,
      byReason: Object.fromEntries([...pair.byReason].map(([reason, value]) => [inWords(reason), kg(value)])),
      cameInKg: kg(cameIn),
      wastePctOfCameIn: pct(pair.kg, cameIn),
      avgDailyCameInKg: kg(cameIn.div(days)),
      soldKg: outlet ? kg(soldKg) : null,
      avgDailySoldKg: outlet ? kg(soldKg.div(days)) : null,
      returnedKg: outlet ? kg(flowOf.get(key)?.returnedKg ?? zero) : null,
      previousWrittenOffKg: kg(before),
      changePct: change(pair.kg, before),
    }
  })

  // Per branch, all its goods together.
  const cameInByBranch = new Map<string, Prisma.Decimal>()
  for (const flow of flows) cameInByBranch.set(flow.branchId, (cameInByBranch.get(flow.branchId) ?? zero).add(flow.inKg ?? zero))
  type BranchTotal = { branch: string; branchType: string; kg: Prisma.Decimal; value: Prisma.Decimal; writeOffs: number; biggest: { good: string; value: Prisma.Decimal } }
  const byBranch = new Map<string, BranchTotal>()
  for (const pair of pairs.values()) {
    const total = byBranch.get(pair.branchId) ?? { branch: pair.branch, branchType: pair.branchType, kg: zero, value: zero, writeOffs: 0, biggest: { good: pair.good, value: zero } }
    total.kg = total.kg.add(pair.kg)
    total.value = total.value.add(pair.value)
    total.writeOffs += pair.writeOffs
    if (pair.value.greaterThan(total.biggest.value)) total.biggest = { good: pair.good, value: pair.value }
    byBranch.set(pair.branchId, total)
  }
  const allWrittenOff = [...byBranch.values()].reduce((sum, total) => sum.add(total.value), zero)
  const branchFacts: WasteBranchFact[] = [...byBranch.entries()]
    .sort(([, a], [, b]) => b.value.comparedTo(a.value))
    .map(([branchId, total], index) => {
      const cameIn = cameInByBranch.get(branchId) ?? zero
      return {
        id: `B${index + 1}`,
        branch: total.branch,
        branchType: total.branchType === 'OUTLET' ? 'outlet' : 'kitchen',
        writeOffs: total.writeOffs,
        writtenOffKg: kg(total.kg),
        writtenOffValue: php(total.value),
        sharePctOfWrittenOff: pct(total.value, allWrittenOff),
        cameInKg: kg(cameIn),
        wastePctOfCameIn: pct(total.kg, cameIn),
        biggestGood: total.biggest.good,
        biggestGoodValue: php(total.biggest.value),
      }
    })

  const lostRoutes = routes
    .filter(route => Number(route.withLoss) > 0)
    .sort((a, b) => (b.lostValue ?? zero).comparedTo(a.lostValue ?? zero))
  const writtenOffKg    = [...pairs.values()].reduce((sum, pair) => sum.add(pair.kg), zero)
  const writtenOffValue = [...pairs.values()].reduce((sum, pair) => sum.add(pair.value), zero)
  const previousValue   = previousWriteOffs.reduce((sum, row) => sum.add(row.value), zero)
  const transitValue    = routes.reduce((sum, route) => sum.add(route.lostValue ?? zero), zero)
  const lostValue       = writtenOffValue.add(transitValue)

  return {
    week, from: windows.from, to: windows.to, days: WASTE_WINDOW_DAYS, currency: 'PHP',
    totals: {
      writtenOffKg: kg(writtenOffKg),
      writtenOffValue: php(writtenOffValue),
      lostInTransitValue: php(transitValue),
      lostValue: php(lostValue),
      productionCost: php(productionCost),
      lostPctOfProductionCost: pct(lostValue, productionCost),
      previousWrittenOffValue: php(previousValue),
      writtenOffChangePct: change(writtenOffValue, previousValue),
    },
    branches: branchFacts,
    rows,
    otherRows: Math.max(0, pairs.size - rows.length),
    routes: lostRoutes.map((route, index) => ({
      id: `T${index + 1}`,
      route: `${route.fromName} → ${route.toName}`,
      deliveries: Number(route.deliveries),
      deliveriesWithLoss: Number(route.withLoss),
      lostKg: kg(route.lostKg ?? zero),
      lostValue: php(route.lostValue ?? zero),
      reasons: (route.reasons ?? []).map(inWords),
    })),
    recovered: conversions.map((row, index) => ({
      id: `C${index + 1}`,
      kitchen: row.branchName,
      conversions: Number(row.count),
      convertedKg: kg(row.sourceKg),
      from: row.sourceName,
      madeKg: kg(row.outputKg),
      into: row.outputName,
    })),
  }
}

// ─── Claude's findings ────────────────────────────────────────────────────────

const PRIORITIES = ['high', 'medium', 'low'] as const

export type WasteFinding = {
  figureIds: string[]
  title: string
  pattern: string
  recommendation: string
  priority: (typeof PRIORITIES)[number]
}
export type WasteReportContent = { summary: string; findings: WasteFinding[] }

/** What Claude must return (structured output): schema-valid every time; the code still checks ids and caps the count. */
const REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings'],
  properties: {
    summary: { type: 'string', description: 'Two sentences: what was lost in total, and which branch and goods most of it is at.' },
    findings: {
      type: 'array',
      description: `At most ${MAX_FINDINGS}, the costliest first.`,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['figureIds', 'title', 'pattern', 'recommendation', 'priority'],
        properties: {
          figureIds:      { type: 'array', items: { type: 'string' }, description: 'Ids of the rows it rests on, e.g. ["W1"], ["B2", "W4"] or ["T1"].' },
          title:          { type: 'string', description: 'Branch and good, a few words.' },
          pattern:        { type: 'string', description: 'What keeps happening, one or two sentences quoting the figures as given.' },
          recommendation: { type: 'string', description: 'One concrete action for this week: who does what.' },
          priority:       { type: 'string', enum: [...PRIORITIES] },
        },
      },
    },
  },
} as const

const ReportSchema = z.object({
  summary: z.string().trim().min(1),
  findings: z.array(z.object({
    figureIds:      z.array(z.string()),
    title:          z.string().trim().min(1),
    pattern:        z.string().trim().min(1),
    recommendation: z.string().trim().min(1),
    priority:       z.enum(PRIORITIES),
  })),
})

const INSTRUCTIONS = `You read the last 30 days of waste at Lydia's Lechon and find the patterns behind it. Kitchens (commissaries) cook; outlets only sell, order from a kitchen and send unsold goods back.

The figures are in <figures>, worked out by the system. Each row has an id:
- W rows: one branch's write-offs of one finished good — kg and ₱, by reason, on how many days — with what came in (delivered to an outlet, or made at a kitchen), what an outlet sold and returned, the waste as a % of what came in, daily averages, and the previous 30 days.
- T rows: delivery routes that lost goods in transit.
- C rows: conversions — unsold goods made into another dish. That is recovered, not waste.
- B rows: each branch's total written off, all goods together, its share of everything written off, and the good it wasted most of.

Find the patterns worth acting on, at most ${MAX_FINDINGS}, the costliest first. A pattern repeats or has a cause: the same good written off at the same branch on many days; an outlet that takes in more than it sells; one reason that keeps coming back (expiry, spoilage, damage, a failed quality check); a route that keeps losing goods; waste that grew against the previous 30 days. Leave out small one-off losses.

Each finding is one distinct problem. When the same thing happens at several branches (e.g. the same good expiring at every kitchen), make it one finding naming all of them, so the others go to different problems — an outlet ordering more than it sells is worth a finding even when its ₱ are smaller.

For each finding:
- figureIds: the ids of the rows it rests on.
- title: the branch and the good, in a few words.
- pattern: what keeps happening, in one or two sentences, quoting the figures exactly as given (₱ and kg).
- recommendation: one concrete thing to do this week, and who does it (the outlet's manager, the kitchen, procurement). If it involves a quantity, use one of the given figures — for example an average daily sold — never a number you worked out.
- priority: high, medium or low, by how much is lost and how often.

summary: two sentences — the total lost, and the branch (B rows) and goods where most of it is.

Never calculate: no sums, differences, percentages or averages of your own. Use only the figures given.`

function reference(week: string): AiInsightReference {
  return { type: AiInsightType.WASTE_PATTERN, referenceType: 'Week', referenceId: week }
}

/** A stored report's content, read back; null when it is not one (never written, or not JSON). */
export function parseReport(content: string | null): WasteReportContent | null {
  if (!content) return null
  try {
    const parsed = ReportSchema.safeParse(JSON.parse(content))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export type WasteReportResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status: number }

/**
 * Generate now / Regenerate / the weekly job: the insight goes PENDING and the
 * job is queued. A week that has not started is refused; asking again while
 * one is pending or written (without regenerate) queues nothing.
 */
async function request(week: string, requestedById: string | null, options: { regenerate?: boolean } = {}): Promise<WasteReportResult<{ queued: boolean }>> {
  const monday = weekKeyStart(week)
  if (!monday) return { success: false, error: 'Unknown week', status: 400 }
  if (monday > todayIsoDate()) return { success: false, error: 'That week has not started yet', status: 400 }

  const ref = reference(week)
  const asked = options.regenerate ? await AiInsightRepository.regenerate(ref) : await AiInsightRepository.request(ref)
  if (!asked) return { success: true, data: { queued: false } }

  try {
    await getAiQueue().add(WASTE_PATTERN_REPORT, { week, requestedById } satisfies WastePatternJob, AI_JOB_OPTIONS)
  } catch (err) {
    console.error('[WastePatternService] could not queue the report', err)
    await AiInsightRepository.fail(ref, { error: 'Could not queue the report (the job queue is unavailable). Try again.' })
  }
  return { success: true, data: { queued: true } }
}

export type WriteOutcome = 'READY' | 'FAILED' | 'RETRY' | 'SKIPPED'

/**
 * Writes a PENDING report (the job): the facts → Claude (structured output)
 * → the findings checked — each must name a row that exists; others are
 * dropped, at most MAX_FINDINGS kept — and stored as JSON. A quiet month with
 * no waste at all is written without calling Claude.
 */
async function write(week: string, options: { userId: string | null; lastAttempt: boolean }): Promise<WriteOutcome> {
  const ref = reference(week)
  const current = await AiInsightRepository.find(ref)
  if (current?.status !== AiInsightStatus.PENDING) return 'SKIPPED'

  const figures = await facts(week)
  if (!figures) {
    await AiInsightRepository.fail(ref, { error: 'Unknown week.' })
    return 'FAILED'
  }
  const factsJson = figures as unknown as Prisma.InputJsonValue

  if (figures.rows.length === 0 && figures.routes.length === 0) {
    const quiet: WasteReportContent = { summary: `No waste was recorded from ${figures.from} to ${figures.to}.`, findings: [] }
    await AiInsightRepository.complete(ref, { content: JSON.stringify(quiet), facts: factsJson, prompt: '', model: 'none', aiCallId: null })
    return 'READY'
  }

  const prompt = `Find the waste patterns from ${figures.from} to ${figures.to} (${figures.days} days).\n\n<figures>\n${JSON.stringify(figures, null, 2)}\n</figures>`
  const result = await AiService.complete({
    feature:      AiFeature.WASTE_PATTERN,
    instructions: INSTRUCTIONS,
    messages:     [{ role: 'user', content: prompt }],
    userId:       options.userId,
    format:       { type: 'json_schema', schema: REPORT_SCHEMA as unknown as Record<string, unknown> },
  })

  if (!result.success) {
    if (result.retryable && !options.lastAttempt) return 'RETRY'
    await AiInsightRepository.fail(ref, { error: result.error, facts: factsJson, prompt, aiCallId: result.callId })
    return 'FAILED'
  }

  const report = parseReport(result.data.text)
  if (!report) {
    await AiInsightRepository.fail(ref, { error: 'The AI returned a report that could not be read.', facts: factsJson, prompt, aiCallId: result.data.callId })
    return 'FAILED'
  }
  const ids = new Set([...figures.branches, ...figures.rows, ...figures.routes, ...figures.recovered].map(row => row.id))
  const findings = report.findings
    .map(finding => ({ ...finding, figureIds: finding.figureIds.filter(id => ids.has(id)) }))
    .filter(finding => finding.figureIds.length > 0)
    .slice(0, MAX_FINDINGS)

  await AiInsightRepository.complete(ref, {
    content: JSON.stringify({ summary: report.summary, findings } satisfies WasteReportContent),
    facts: factsJson, prompt, model: result.data.servedModel, aiCallId: result.data.callId,
  })
  return 'READY'
}

/** The job's last word when it dies of an unexpected error: a PENDING report must not spin forever. */
async function giveUp(week: string, error: string): Promise<void> {
  await AiInsightRepository.fail(reference(week), { error })
}

export type WasteDashboardDto = {
  week: string
  facts: WasteFacts
  insight: AiInsightDto | null
  report: WasteReportContent | null
}

/** The dashboard card: this week's report (the 30 days before Monday) and its figures, worked out now. */
async function dashboard(today = todayIsoDate()): Promise<WasteDashboardDto> {
  const week = isoWeekKey(today)
  const [figures, row] = await Promise.all([facts(week), AiInsightRepository.find(reference(week))])
  const insight = row ? toInsightDto(row) : null
  return { week, facts: figures!, insight, report: parseReport(insight?.content ?? null) }
}

export const WastePatternService = {
  facts,
  request,
  write,
  giveUp,
  dashboard,
}

