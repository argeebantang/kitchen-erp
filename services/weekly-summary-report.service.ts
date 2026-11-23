import { addDays } from '@/lib/dates'
import { productionSummaryReport } from '@/services/production-report.service'
import { inventoryMovementReport, procurementReport, wasteReport } from '@/services/operations-report.service'
import { ApprovalInboxService } from '@/services/approval-inbox.service'
import { WastePatternService } from '@/services/waste-pattern.service'
import type { ReportDto, ReportFigureDto, ReportParams, ReportTableDto } from '@/services/report.service'

/**
 * The Weekly Management Summary (Week 11 Task 7): the week on a few pages, for
 * the Monday 07:00 email to management and for anyone in management to open.
 * It runs the other reports for the same period and takes their headline
 * figures and key tables as they are — a summary, never a second calculation
 * — plus KitchenAI's waste findings for the 30 days to the week's Sunday,
 * when that report has been written (06:00 Mondays).
 */

type Built = Pick<ReportDto, 'figures' | 'tables' | 'notes'>

/** As management sees the inbox: every pending document. */
const INBOX_VIEWER = { userId: '', role: 'ADMIN' }

/** One of a built report's figures, by label — renamed with `as` where the summary says it differently. */
function pick(built: Built, label: string, as?: string): ReportFigureDto {
  const found = built.figures.find(figure => figure.label === label)
  // A renamed figure would otherwise vanish from the summary without a word.
  if (!found) throw new Error(`Weekly summary: no figure "${label}" in its source report`)
  return as ? { ...found, label: as } : found
}

function table(built: Built, title: string, as: string): ReportTableDto {
  const found = built.tables.find(t => t.title === title)
  if (!found) throw new Error(`Weekly summary: no table "${title}" in its source report`)
  return { ...found, title: as }
}

const PRIORITY_WORDS: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' }

export async function weeklySummaryReport(params: ReportParams): Promise<Built> {
  // Every branch: the summary is company-wide.
  const all: ReportParams = { ...params, branch: null }
  const [production, waste, procurement, stock, inbox, kitchenAi] = await Promise.all([
    productionSummaryReport(all),
    wasteReport(all),
    procurementReport(all),
    inventoryMovementReport(all),
    ApprovalInboxService.list(INBOX_VIEWER),
    // The Monday after the period: its waste report covers the 30 days to the period's Sunday.
    WastePatternService.dashboard({ today: addDays(params.to, 1) }),
  ])
  const findings = kitchenAi.report?.findings ?? []

  return {
    figures: [
      pick(production,  'Production cost'),
      pick(production,  'Batches signed off'),
      pick(production,  'Over plan'),
      pick(waste,       'Written off'),
      pick(waste,       'Lost in transit'),
      pick(procurement, 'Value ordered'),
      pick(procurement, 'Received', 'Received from suppliers'),
      pick(procurement, 'Short', 'Short from suppliers'),
      pick(stock,       'Finished goods, closing', 'Finished goods at week end'),
      { label: 'Waiting for approval', value: inbox.total, kind: 'count', note: 'Now, when this was generated' },
    ],
    tables: [
      table(production,  'By kitchen', 'Production by kitchen'),
      table(production,  'By product', 'Production by product'),
      table(waste,       'By branch', 'Waste by branch'),
      table(procurement, 'Supplier performance', 'Suppliers'),
      {
        title:       'KitchenAI: waste patterns',
        description: kitchenAi.report
          ? `Claude's reading of the 30 days to ${params.to}: ${kitchenAi.report.summary}`
          : 'The weekly waste report for these 30 days has not been written yet (it runs Mondays at 06:00, or from the Dashboard).',
        columns: [
          { key: 'priority',       label: 'Priority',       kind: 'text' },
          { key: 'title',          label: 'Finding',        kind: 'text' },
          { key: 'pattern',        label: 'Pattern',        kind: 'text' },
          { key: 'recommendation', label: 'Recommendation', kind: 'text' },
        ],
        rows:      findings.map(finding => ({ priority: PRIORITY_WORDS[finding.priority] ?? finding.priority, title: finding.title, pattern: finding.pattern, recommendation: finding.recommendation })),
        total:     null,
        emptyText: kitchenAi.report ? 'No waste pattern worth acting on.' : 'Not written yet.',
      },
    ],
    notes: [
      'Each figure and table is taken unchanged from its report — Production Summary, Waste & Write-off, Procurement, Inventory Movement — for the same week; open those for the full detail.',
      'The KitchenAI findings are written by Claude from figures the system computed; every amount in them is quoted from those figures.',
      ...production.notes,
    ],
  }
}
