import { BranchType } from '@prisma/client'
import { addDays, addMonths, todayIsoDate, weekStartOf } from '@/lib/dates'
import { BranchRepository } from '@/repositories/branch.repository'
import { UserRepository } from '@/repositories/user.repository'
import { EMAIL_JOB_OPTIONS, getEmailQueue, REPORT_EMAIL, type ReportEmailJob } from '@/lib/queue'
import { costPerBatchReport, productionSummaryReport } from '@/services/production-report.service'
import { inventoryMovementReport, procurementReport, wasteReport } from '@/services/operations-report.service'
import { endOfDaySnapshotReport } from '@/services/end-of-day-report.service'
import { weeklySummaryReport } from '@/services/weekly-summary-report.service'

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
  /** And its id — what an emailed copy is generated for (Task 7). */
  branchId: string | null
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

/** Which branches a report can be narrowed to: kitchens only, any branch, or none (company-wide). */
type BranchFilter = 'kitchens' | 'branches' | 'none'

type ReportDefinition = {
  key: ReportKey
  title: string
  description: string
  /** Who may open it (owner, 2026-11-23). */
  roles: string[]
  branchFilter: BranchFilter
  /**
   * A branch manager sees only the branch they manage (owner, 2026-11-23):
   * the filter is fixed to it, read from Branch.managerId, not the token.
   */
  ownBranchForManagers?: boolean
  /** 'day': one business day (Today, Yesterday or a date) — the End-of-Day Snapshot (Task 6). Default: a period. */
  span?: 'period' | 'day'
  build: (params: ReportParams) => Promise<Omit<ReportDto, 'key' | 'title' | 'from' | 'to' | 'periodLabel' | 'branchName' | 'branchId' | 'generatedAt'>>
}

export const REPORT_KEYS = ['production-summary', 'cost-per-batch', 'inventory-movement', 'procurement', 'waste', 'end-of-day', 'weekly-summary'] as const
export type ReportKey = (typeof REPORT_KEYS)[number]

export function isReportKey(value: string): value is ReportKey {
  return (REPORT_KEYS as readonly string[]).includes(value)
}

/**
 * Who opens what (owner, 2026-11-23): management (admin, accounting, viewer)
 * every report; production its production, waste and stock reports;
 * procurement its own and stock; a branch manager stock movement at their
 * own branch.
 */
const MANAGEMENT = ['ADMIN', 'ACCOUNTING', 'VIEWER']
const PRODUCTION_REPORT_ROLES = [...MANAGEMENT, 'PRODUCTION_MANAGER']

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
  'inventory-movement': {
    key:          'inventory-movement',
    title:        'Inventory Movement',
    description:  'Finished goods and raw materials at each branch: opening, what came in and went out, and closing.',
    roles:        [...MANAGEMENT, 'PRODUCTION_MANAGER', 'PROCUREMENT_MANAGER', 'BRANCH_MANAGER'],
    branchFilter: 'branches',
    ownBranchForManagers: true,
    build:        inventoryMovementReport,
  },
  procurement: {
    key:          'procurement',
    title:        'Procurement',
    description:  'Orders approved and their value, deliveries by supplier — short, rejected, late — and materials that came short.',
    roles:        [...MANAGEMENT, 'PROCUREMENT_MANAGER'],
    branchFilter: 'none',
    build:        procurementReport,
  },
  waste: {
    key:          'waste',
    title:        'Waste & Write-off',
    description:  'What was written off and lost in transit, by branch and good and by reason, against the period before.',
    roles:        PRODUCTION_REPORT_ROLES,
    branchFilter: 'branches',
    build:        wasteReport,
  },
  'end-of-day': {
    key:          'end-of-day',
    title:        'End-of-Day Snapshot',
    description:  'One branch\'s day, or every branch\'s: finished goods in and out, raw materials, what moved and what is still waiting for approval.',
    roles:        [...MANAGEMENT, 'PRODUCTION_MANAGER', 'BRANCH_MANAGER'],
    branchFilter: 'branches',
    ownBranchForManagers: true,
    span:         'day',
    build:        endOfDaySnapshotReport,
  },
  'weekly-summary': {
    key:          'weekly-summary',
    title:        'Weekly Management Summary',
    description:  'The week on a few pages: production, waste, purchasing and stock at a glance, with KitchenAI\'s waste findings. Emailed to management every Monday at 07:00.',
    roles:        MANAGEMENT,
    branchFilter: 'none',
    build:        weeklySummaryReport,
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

/** A one-day report's choices (Task 6); "today" is the default — the evening close. */
export const DAY_PRESETS = [
  { value: 'today',     label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
] as const

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
  /** A one-day report's date (YYYY-MM-DD). */
  date?: string | null
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
  /** What "no branch chosen" covers: "All kitchens", "All branches", "Company-wide". */
  allLabel: string
  /** A branch manager held to their own branch: no "All" to choose. */
  branchFixed: boolean
  maxDays: number
  /** One day, not a period: one date to pick. */
  singleDay: boolean
}

type Viewer = { userId: string; role: string }

/** Who "Email to management" reaches, and who may send to them (owner, 2026-11-23). */
const MANAGEMENT_RECIPIENT_ROLES = ['ADMIN', 'ACCOUNTING'] as const

export type ReportEmailResult = {
  /** How many emails were queued — one per person with a notification address. */
  queued: number
  /** Those it could not go to: no notification address. */
  withoutAddress: string[]
}

function definitionFor(key: string, viewer: Viewer): ReportResult<ReportDefinition> {
  if (!isReportKey(key)) return { success: false, error: 'No such report', status: 404 }
  const definition = REPORTS[key]
  if (!definition.roles.includes(viewer.role)) return { success: false, error: 'You cannot open this report', status: 403 }
  return { success: true, data: definition }
}

/** A one-day report's day: a date, or Today / Yesterday (default today). Not after today. */
function resolveDay(query: ReportQuery): ReportResult<{ from: string; to: string }> {
  const today = todayIsoDate()
  if (query.date) {
    if (!isDate(query.date)) return { success: false, error: 'Give the date as YYYY-MM-DD', status: 400 }
    if (query.date > today) return { success: false, error: 'The day cannot be after today', status: 400 }
    return { success: true, data: { from: query.date, to: query.date } }
  }
  const day = query.preset === 'yesterday' ? addDays(today, -1) : today
  return { success: true, data: { from: day, to: day } }
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
  if (filter === 'kitchens') return BranchRepository.findActiveKitchens()
  if (filter === 'branches') return BranchRepository.findAllActive()
  return []
}

/** The branch a branch manager is held to, when the report does that; undefined when it does not apply. */
async function managersBranch(definition: ReportDefinition, viewer: Viewer): Promise<ReportResult<{ id: string; name: string }> | undefined> {
  if (!definition.ownBranchForManagers || viewer.role !== 'BRANCH_MANAGER') return undefined
  const managed = await BranchRepository.findManagedBy(viewer.userId)
  if (!managed) return { success: false, error: 'You do not manage a branch yet — ask an admin to assign you one', status: 403 }
  return { success: true, data: { id: managed.id, name: managed.name } }
}

export const ReportService = {
  /**
   * "Email this report" (Week 11 Task 7): the report as the viewer sees it now
   * — their role, period and branch rules applied by running it — emailed as
   * a PDF to themselves, or by ADMIN / ACCOUNTING to management. One
   * REPORT_EMAIL job per person on the email queue, with the period and
   * branch fixed, so what arrives is what was on screen.
   */
  async email(key: string, query: ReportQuery, recipients: 'me' | 'management', viewer: Viewer): Promise<ReportResult<ReportEmailResult>> {
    if (recipients === 'management' && !(MANAGEMENT_RECIPIENT_ROLES as readonly string[]).includes(viewer.role)) {
      return { success: false, error: 'Only admin and accounting can email a report to management', status: 403 }
    }
    const report = await ReportService.run(key, query, viewer)
    if (!report.success) return report
    const { data } = report

    const everyone = await UserRepository.listWithNotificationEmail()
    const sender = everyone.find(user => user.id === viewer.userId)
    const people = recipients === 'me'
      ? everyone.filter(user => user.id === viewer.userId)
      : everyone.filter(user => (MANAGEMENT_RECIPIENT_ROLES as readonly string[]).includes(user.role))
    const reachable = people.filter(user => user.notificationEmail !== null)

    const fixed: ReportEmailJob['query'] = REPORTS[data.key].span === 'day'
      ? { date: data.from, branchId: data.branchId }
      : { from: data.from, to: data.to, branchId: data.branchId }
    if (reachable.length > 0) {
      await getEmailQueue().addBulk(reachable.map(user => ({
        name: REPORT_EMAIL,
        data: { report: data.key, query: fixed, userId: user.id, requestedByName: sender?.name ?? 'Someone' } satisfies ReportEmailJob,
        opts: EMAIL_JOB_OPTIONS,
      })))
    }
    return {
      success: true,
      data: { queued: reachable.length, withoutAddress: people.filter(user => user.notificationEmail === null).map(user => user.name) },
    }
  },

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
    const own = await managersBranch(definition, viewer)
    if (own && !own.success) return own
    return {
      success: true,
      data: {
        key:         definition.key,
        title:       definition.title,
        description: definition.description,
        presets:     (definition.span === 'day' ? DAY_PRESETS : REPORT_PRESETS).map(({ value, label }) => ({ value, label })),
        branches:    own ? [own.data] : await branchesFor(definition.branchFilter),
        branchLabel: definition.branchFilter === 'kitchens' ? 'Kitchen' : definition.branchFilter === 'branches' ? 'Branch' : null,
        allLabel:    definition.branchFilter === 'kitchens' ? 'All kitchens' : definition.branchFilter === 'branches' ? 'All branches' : 'Company-wide',
        branchFixed: own !== undefined,
        singleDay:   definition.span === 'day',
        maxDays:     MAX_REPORT_DAYS,
      },
    }
  },

  async run(key: string, query: ReportQuery, viewer: Viewer): Promise<ReportResult<ReportDto>> {
    const found = definitionFor(key, viewer)
    if (!found.success) return found
    const definition = found.data

    const period = definition.span === 'day' ? resolveDay(query) : resolvePeriod(query)
    if (!period.success) return period

    let branch: { id: string; name: string } | null = null
    const own = await managersBranch(definition, viewer)
    if (own && !own.success) return own
    if (own) {
      // Held to their own branch: another branch's id is refused, none means theirs.
      if (query.branchId && query.branchId !== own.data.id) return { success: false, error: 'You can only see your own branch', status: 403 }
      branch = own.data
    } else if (query.branchId) {
      if (definition.branchFilter === 'none') return { success: false, error: 'This report covers every branch', status: 400 }
      const row = await BranchRepository.findById(query.branchId)
      // Inactive kitchens still open: a past period may have one.
      if (!row || (definition.branchFilter === 'kitchens' && row.type !== BranchType.COMMISSARY)) {
        return { success: false, error: definition.branchFilter === 'kitchens' ? 'Choose one of the kitchens' : 'Choose one of the branches', status: 400 }
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
        branchId:    branch?.id ?? null,
        generatedAt: new Date().toISOString(),
        ...built,
      },
    }
  },
}
