import { trimDecimal } from '@/lib/format'
import { CostingService, type PeriodGroupDto } from '@/services/costing.service'
import type { ReportColumnDto, ReportDto, ReportParams, ReportTableDto } from '@/services/report.service'

/**
 * The Production Summary and Cost per Batch reports (Week 11 Task 4). Every
 * figure comes from CostingService.productionDetail — the same calculation as
 * the Costing dashboard and the assistant's production costs — so these
 * builders only arrange it into tables.
 */

type Built = Pick<ReportDto, 'figures' | 'tables' | 'notes'>

/** Shown under every money table: rows are rounded, totals are not. */
export const ROUNDING_NOTE = 'Amounts are rounded to the centavo; a total is the exact sum rounded once, so rows can differ from it by a few centavos.'

const SIGN_OFF_NOTE = 'Figures count once signed off: a batch or conversion on its lot\'s production date — the same rule as the Costing dashboard. Late sign-offs change a past period.'

/** Production statuses in workflow order, in words (drafts are not counted). */
const STATUS_WORDS: Record<string, string> = {
  PENDING_APPROVAL:   'Waiting for approval',
  APPROVED:           'Approved, not started',
  IN_PROGRESS:        'Cooking',
  PENDING_COMPLETION: 'Reported done, awaiting sign-off',
  COMPLETED:          'Completed',
  REJECTED:           'Rejected',
  CANCELLED:          'Cancelled',
}

const GROUP_COLUMNS: ReportColumnDto[] = [
  { key: 'batchCount',      label: 'Batches',               kind: 'count' },
  { key: 'batchCost',       label: 'Batch cost',            kind: 'peso' },
  { key: 'overPlan',        label: 'Over plan',             kind: 'peso' },
  { key: 'conversionCount', label: 'Conversions',           kind: 'count' },
  { key: 'conversionCost',  label: 'Added in conversions',  kind: 'peso' },
  { key: 'productionCost',  label: 'Production cost',       kind: 'peso' },
]

function groupTable(title: string, keyLabel: string, keyKind: 'text' | 'date', groups: PeriodGroupDto[], total: Omit<PeriodGroupDto, 'key'>, emptyText: string): ReportTableDto {
  return {
    title,
    columns:   [{ key: 'key', label: keyLabel, kind: keyKind }, ...GROUP_COLUMNS],
    rows:      groups.map(group => ({ ...group })),
    total:     groups.length > 1 ? { key: 'Total', ...total } : null,
    emptyText,
  }
}

export async function productionSummaryReport({ from, to, branch }: ReportParams): Promise<Built> {
  const detail = await CostingService.productionDetail(from, to, branch?.id ?? null)
  const totals = {
    batchCount:      detail.batchCount,
    batchCost:       detail.batchCost,
    overPlan:        detail.overPlan,
    conversionCount: detail.conversionCount,
    conversionCost:  detail.conversionCost,
    productionCost:  detail.productionCost,
  }
  const orderCount = detail.ordersByStatus.reduce((sum, row) => sum + row.count, 0)

  return {
    figures: [
      { label: 'Production cost',      value: detail.productionCost,  kind: 'peso',  note: 'Signed-off batches + ingredients added in conversions' },
      { label: 'Batches signed off',   value: detail.batchCount,      kind: 'count' },
      { label: 'Batch cost',           value: detail.batchCost,       kind: 'peso' },
      { label: 'Over plan',            value: detail.overPlan,        kind: 'peso',  note: 'What batches cost beyond their plan for what they made' },
      { label: 'Conversions',          value: detail.conversionCount, kind: 'count' },
      { label: 'Added in conversions', value: detail.conversionCost,  kind: 'peso' },
      { label: 'Awaiting sign-off',    value: detail.awaitingSignOff, kind: 'count', note: 'Reported done in the period, not in these figures yet' },
    ],
    tables: [
      {
        title:       'By product',
        description: 'What was made, runs and conversions together. Cost includes a conversion\'s source, so these do not add up to production cost.',
        columns: [
          { key: 'product',         label: 'Product',       kind: 'text' },
          { key: 'batchCount',      label: 'Batches',       kind: 'count' },
          { key: 'conversionCount', label: 'Conversions',   kind: 'count' },
          { key: 'quantityMade',    label: 'Made',          kind: 'quantity' },
          { key: 'unit',            label: 'Unit',          kind: 'text' },
          { key: 'cost',            label: 'Cost',          kind: 'peso' },
          { key: 'costPerUnit',     label: 'Cost per unit', kind: 'peso' },
        ],
        rows:      detail.byProduct.map(row => ({ ...row })),
        total:     null,
        emptyText: 'Nothing was signed off in this period.',
      },
      groupTable('By kitchen', 'Kitchen', 'text', detail.byKitchen, totals, 'No kitchen signed off a batch or conversion in this period.'),
      groupTable('By day', 'Day', 'date', detail.byDay, totals, 'No batch or conversion was signed off in this period.'),
      {
        title:       'Orders planned for the period',
        description: 'Production orders planned for a day in the period, by where they stand now (drafts left out). Counted by planned date, so not the same runs as the figures above.',
        columns:     [{ key: 'status', label: 'Status', kind: 'text' }, { key: 'count', label: 'Orders', kind: 'count' }],
        rows:        Object.keys(STATUS_WORDS)
          .flatMap(status => {
            const row = detail.ordersByStatus.find(entry => entry.status === status)
            return row ? [{ status: STATUS_WORDS[status], count: row.count }] : []
          }),
        total:       orderCount > 0 ? { status: 'Total', count: orderCount } : null,
        emptyText:   'No production order was planned for this period.',
      },
    ],
    notes: [SIGN_OFF_NOTE, ROUNDING_NOTE],
  }
}

export async function costPerBatchReport({ from, to, branch }: ReportParams): Promise<Built> {
  const detail = await CostingService.productionDetail(from, to, branch?.id ?? null)

  return {
    figures: [
      { label: 'Batches signed off',   value: detail.batchCount,      kind: 'count' },
      { label: 'Planned cost',         value: detail.plannedCost,     kind: 'peso', note: 'The recipes at reference prices on each planned date' },
      { label: 'Actual cost',          value: detail.batchCost,       kind: 'peso' },
      { label: 'Over plan',            value: detail.overPlan,        kind: 'peso', note: 'Actual cost − planned cost per unit × what was made' },
      { label: 'Conversions',          value: detail.conversionCount, kind: 'count' },
      { label: 'Added in conversions', value: detail.conversionCost,  kind: 'peso' },
    ],
    tables: [
      {
        title:   'Batches',
        description: 'Every signed-off run, in the order made. Yield is what was made as a % of the plan.',
        columns: [
          { key: 'orderNumber',   label: 'Order',         kind: 'text' },
          { key: 'producedOn',    label: 'Made on',       kind: 'date' },
          { key: 'branch',        label: 'Kitchen',       kind: 'text' },
          { key: 'product',       label: 'Product',       kind: 'text' },
          { key: 'plannedQty',    label: 'Planned',       kind: 'quantity' },
          { key: 'quantity',      label: 'Made',          kind: 'quantity' },
          { key: 'unit',          label: 'Unit',          kind: 'text' },
          { key: 'percentOfPlan', label: 'Yield',         kind: 'percent' },
          { key: 'plannedCost',   label: 'Planned cost',  kind: 'peso' },
          { key: 'cost',          label: 'Actual cost',   kind: 'peso' },
          { key: 'costPerUnit',   label: 'Cost per unit', kind: 'peso' },
          { key: 'overPlan',      label: 'Over plan',     kind: 'peso' },
        ],
        rows:  detail.runs.map(run => ({ ...run })),
        total: detail.runs.length > 1
          ? { orderNumber: 'Total', plannedCost: detail.plannedCost, cost: detail.batchCost, overPlan: detail.overPlan }
          : null,
        emptyText: 'No batch was signed off in this period.',
      },
      {
        title:   'Conversions',
        description: 'Approved conversions: unsold goods made into another product. Cost is the source lots\' cost plus what was added.',
        columns: [
          { key: 'orderNumber', label: 'Conversion',    kind: 'text' },
          { key: 'producedOn',  label: 'Made on',       kind: 'date' },
          { key: 'branch',      label: 'Kitchen',       kind: 'text' },
          { key: 'product',     label: 'Product',       kind: 'text' },
          { key: 'from',        label: 'From',          kind: 'text' },
          { key: 'quantity',    label: 'Made',          kind: 'quantity' },
          { key: 'unit',        label: 'Unit',          kind: 'text' },
          { key: 'sourceCost',  label: 'Source cost',   kind: 'peso' },
          { key: 'addedCost',   label: 'Added',         kind: 'peso' },
          { key: 'cost',        label: 'Cost',          kind: 'peso' },
          { key: 'costPerUnit', label: 'Cost per unit', kind: 'peso' },
        ],
        rows: detail.conversions.map(conversion => ({
          ...conversion,
          from: `${trimDecimal(conversion.sourceQty)} ${conversion.sourceUnit} ${conversion.source}`,
        })),
        total:     detail.conversions.length > 1 ? { orderNumber: 'Total', addedCost: detail.conversionCost } : null,
        emptyText: 'No conversion was approved in this period.',
      },
    ],
    notes: [SIGN_OFF_NOTE, ROUNDING_NOTE],
  }
}
