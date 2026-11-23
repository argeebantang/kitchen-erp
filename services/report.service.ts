import { BranchType } from '@prisma/client'
import { addDays, addMonths, todayIsoDate, weekStartOf } from '@/lib/dates'
import { BranchRepository } from '@/repositories/branch.repository'
import { costPerBatchReport, productionSummaryReport } from '@/services/production-report.service'

/**
 * Reports (Week 11, Tasks 4–6): one engine, many reports. A report is a
 * service method that returns a ReportDto — headline figures and tables of
 * plain values — taken from the services that already compute them (Costing,
 * End of Day, Waste, the Stock Ledger…), never worked out a second time. The
 * page (components/reports/ReportView), the Excel (lib/xlsx) and the PDF
 * (components/pdf/ReportDocument) all render that one DTO, so the three
 * cannot disagree. Nothing is stored: a report is generated when asked for,
 * from the figures as they are then (decided late = counted late, as on the
 * Costing dashboard).
 */

// ─── The report shape ─────────────────────────────────────────────────────────

/** How a value is shown: money as ₱ (PHP in a PDF), quantities to the gram, percent with %. */
export type ReportValueKind = 'text' | 'date' | 'count' | 'quantity' | 'peso' | 'percent'

/** A value: a decimal string for numbers (never a float), text, or null for "—". */
export type ReportCell = string | number | null

export type ReportColumnDto = { key: string; label: string; kind: ReportValueKind }

export type ReportTableDto = {
  title: string
  description?: string
  columns: ReportColumnDto[]
  rows: Record<string, ReportCell>[]
  /** The total row, where one adds up; null where it would not (e.g. cost per unit). */
  total: Record<string, ReportCell> | null
  emptyText: string
}

export type ReportFigureDto = { label: string; value: ReportCell; kind: ReportValueKind; note?: string }

export type ReportDto = {
  key: ReportKey
  title: string
  /** Inclusive YYYY-MM-DD. */
  from: string
  to: string
  periodLabel: string
  /** The branch filter's name; null = all. */
  branchName: string | null
  /** ISO — when this was generated. */
  generatedAt: string
  figures: ReportFigureDto[]
  tables: ReportTableDto[]
  notes: string[]
}

/** What a report builder is given: a checked period and branch. */
export type ReportParams = {
  from: string
  to: string
  periodLabel: string
  branch: { id: string; name: string } | null
}

// ─── The registry ─────────────────────────────────────────────────────────────

/** Which branches a report can be narrowed to. */
type BranchFilter = 'kitchens' | 'none'

type ReportDefinition = {
  key: ReportKey
  title: string
  description: string
  /** Who may open it (owner, 2026-11-23). */
  roles: string[]
  branchFilter: BranchFilter
  build: (params: ReportParams) => Promise<Omit<ReportDto, 'key' | 'title' | 'from' | 'to' | 'periodLabel' | 'branchName' | 'generatedAt'>>
}

export const REPORT_KEYS = ['production-summary', 'cost-per-batch'] as const
export type ReportKey = (typeof REPORT_KEYS)[number]

export function isReportKey(value: string): value is ReportKey {
  return (REPORT_KEYS as readonly string[]).includes(value)
}

/** Management sees every report; production its own (owner, 2026-11-23). */
const PRODUCTION_REPORT_ROLES = ['ADMIN', 'ACCOUNTING', 'VIEWER', 'PRODUCTION_MANAGER']

const REPORTS: Record<ReportKey, ReportDefinition> = {
  'production-summary': {
    key:          'production-summary',
    title:        'Production Summary',
    description:  'What the kitchens made and what it cost — by product, kitchen and day, and where the period\'s orders stand.',
    roles:        PRODUCTION_REPORT_ROLES,
    branchFilter: 'kitchens',
    build:        productionSummaryReport,
  },
  'cost-per-batch': {
    key:          'cost-per-batch',
    title:        'Cost per Batch',
    description:  'Every signed-off run with its planned and actual cost, cost per unit and variance, and every conversion.',
    roles:        PRODUCTION_REPORT_ROLES,
    branchFilter: 'kitchens',
    build:        costPerBatchReport,
  },
}

// ─── Periods ──────────────────────────────────────────────────────────────────

export const REPORT_PRESETS = [
  { value: 'last-week',  label: 'Last week' },
  { value: 'this-week',  label: 'This week' },
  { value: 'last-month', label: 'Last month' },
  { value: 'this-month', label: 'This month' },
] as const
export type ReportPreset = (typeof REPORT_PRESETS)[number]['value']

/** The longest custom period, in days — about a quarter (owner, 2026-11-23). */
export const MAX_REPORT_DAYS = 92

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const isDate = (value: string) => DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)

/** A preset's dates, Manila calendar. Weeks run Monday to Sunday; "this" periods end today. */
export function presetPeriod(preset: ReportPreset, today = todayIsoDate()): { from: string; to: string } {
  const monday = weekStartOf(today)
  const month = today.slice(0, 7)
  switch (preset) {
    case 'this-week':  return { from: monday, to: today }
    case 'last-week':  return { from: addDays(monday, -7), to: addDays(monday, -1) }
    case 'this-month': return { from: `${month}-01`, to: today }
    case 'last-month': return { from: `${addMonths(month, -1)}-01`, to: addDays(`${month}-01`, -1) }
  }
}

/** "Mon, Nov 16 – Sun, Nov 22, 2026", or one day: "Mon, Nov 23, 2026". */
export function periodLabel(from: string, to: string): string {
  const day = (date: string, withYear: boolean) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-PH', {
    weekday: 'short', month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC',
  })
  return from === to ? day(from, true) : `${day(from, from.slice(0, 4) !== to.slice(0, 4))} – ${day(to, true)}`
}

/** The inclusive number of days in a period. */
export function periodDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
}

// ─── Running a report ─────────────────────────────────────────────────────────

export type ReportQuery = {
  preset?: string | null
  from?: string | null
  to?: string | null
  branchId?: string | null
}

export type ReportResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status: number }

export type ReportListItemDto = { key: ReportKey; title: string; description: string }

export type ReportOptionsDto = {
  key: ReportKey
  title: string
  description: string
  presets: { value: string; label: string }[]
  branches: { id: string; name: string }[]
  branchLabel: string | null
  maxDays: number
}

type Viewer = { userId: string; role: string }

function definitionFor(key: string, viewer: Viewer): ReportResult<ReportDefinition> {
  if (!isReportKey(key)) return { success: false, error: 'No such report', status: 404 }
  const definition = REPORTS[key]
  if (!definition.roles.includes(viewer.role)) return { success: false, error: 'You cannot open this report', status: 403 }
  return { success: true, data: definition }
}

/** The period asked for: a preset, or from–to, else last week. Checked against today and MAX_REPORT_DAYS. */
function resolvePeriod(query: ReportQuery): ReportResult<{ from: string; to: string }> {
  const today = todayIsoDate()
  const preset = REPORT_PRESETS.find(option => option.value === query.preset)?.value
  if (!query.from && !query.to) return { success: true, data: presetPeriod(preset ?? 'last-week', today) }
  if (preset) return { success: true, data: presetPeriod(preset, today) }

  const from = query.from ?? ''
  const to = query.to ?? ''
  if (!isDate(from) || !isDate(to)) return { success: false, error: 'Give both dates as YYYY-MM-DD', status: 400 }
  if (from > to) return { success: false, error: 'The start date is after the end date', status: 400 }
  if (to > today) return { success: false, error: 'The period cannot end after today', status: 400 }
  if (periodDays(from, to) > MAX_REPORT_DAYS) return { success: false, error: `A report covers at most ${MAX_REPORT_DAYS} days`, status: 400 }
  return { success: true, data: { from, to } }
}

async function branchesFor(filter: BranchFilter): Promise<{ id: string; name: string }[]> {
  return filter === 'kitchens' ? BranchRepository.findActiveKitchens() : []
}

export const ReportService = {
  /** The reports this role may open, for the Reports page. */
  list(viewer: Viewer): ReportListItemDto[] {
    return REPORT_KEYS
      .map(key => REPORTS[key])
      .filter(definition => definition.roles.includes(viewer.role))
      .map(({ key, title, description }) => ({ key, title, description }))
  },

  /** What the report page's filter bar offers. */
  async options(key: string, viewer: Viewer): Promise<ReportResult<ReportOptionsDto>> {
    const found = definitionFor(key, viewer)
    if (!found.success) return found
    const definition = found.data
    return {
      success: true,
      data: {
        key:         definition.key,
        title:       definition.title,
        description: definition.description,
        presets:     REPORT_PRESETS.map(({ value, label }) => ({ value, label })),
        branches:    await branchesFor(definition.branchFilter),
        branchLabel: definition.branchFilter === 'kitchens' ? 'Kitchen' : null,
        maxDays:     MAX_REPORT_DAYS,
      },
    }
  },

  async run(key: string, query: ReportQuery, viewer: Viewer): Promise<ReportResult<ReportDto>> {
    const found = definitionFor(key, viewer)
    if (!found.success) return found
    const definition = found.data

    const period = resolvePeriod(query)
    if (!period.success) return period

    let branch: { id: string; name: string } | null = null
    if (query.branchId) {
      if (definition.branchFilter === 'none') return { success: false, error: 'This report covers every branch', status: 400 }
      const row = await BranchRepository.findById(query.branchId)
      // Inactive kitchens still open: a past period may have one.
      if (!row || (definition.branchFilter === 'kitchens' && row.type !== BranchType.COMMISSARY)) {
        return { success: false, error: 'Choose one of the kitchens', status: 400 }
      }
      branch = { id: row.id, name: row.name }
    }

    const { from, to } = period.data
    const label = periodLabel(from, to)
    const built = await definition.build({ from, to, periodLabel: label, branch })
    return {
      success: true,
      data: {
        key:         definition.key,
        title:       definition.title,
        from,
        to,
        periodLabel: label,
        branchName:  branch?.name ?? null,
        generatedAt: new Date().toISOString(),
        ...built,
      },
    }
  },
}
