import { Prisma } from '@prisma/client'
import { toDecimalString } from '@/lib/decimal'
import { BUSINESS_TIME_ZONE } from '@/lib/dates'
import { formatWaited } from '@/lib/format'
import { EndOfDayService } from '@/services/end-of-day.service'
import { InventoryService } from '@/services/inventory.service'
import { APPROVAL_TYPE_LABELS, ApprovalInboxService } from '@/services/approval-inbox.service'
import { ROUNDING_NOTE } from '@/services/production-report.service'
import type { ReportDto, ReportParams } from '@/services/report.service'

/**
 * The End-of-Day Snapshot (Week 11 Task 6): one business day at one branch,
 * or every branch — what the End of Day page shows, plus the raw materials
 * and what is still waiting for approval, as a report (page, Excel, PDF) and
 * as the PDF the 21:00 job emails.
 *
 * Every figure is another service's: EndOfDayService.forDay (finished goods,
 * the day's documents), InventoryService.materialFlows (the Stock Ledger for
 * the day) and ApprovalInboxService.list (what waits). Nothing is worked out
 * here but which rows belong to the branch.
 */

type Built = Pick<ReportDto, 'figures' | 'tables' | 'notes'>

/** The approvals inbox as management sees it: every pending document. */
const INBOX_VIEWER = { userId: '', role: 'ADMIN' }

const FLOW_WORDS: Record<string, string> = {
  produced:     'Produced',
  convertedIn:  'Made in a conversion',
  convertedOut: 'Used in a conversion',
  writtenOff:   'Written off',
  sold:         'Sold',
  distributed:  'Transferred',
  other:        'Other',
}

const negate = (value: string) => toDecimalString(new Prisma.Decimal(value).neg())

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-PH', { timeZone: BUSINESS_TIME_ZONE, hour: 'numeric', minute: '2-digit' })

export async function endOfDaySnapshotReport({ from: day, branch }: ReportParams): Promise<Built> {
  const branchId = branch?.id ?? null
  const [goods, materials, inbox] = await Promise.all([
    EndOfDayService.forDay(day, branchId, null),
    InventoryService.materialFlows(day, day, branchId),
    ApprovalInboxService.list(INBOX_VIEWER),
  ])
  const t = goods.totals
  const now = Date.now()

  // What waits at this branch: its own documents, and transfers to or from it.
  const waiting = inbox.items.filter(item => !branch || item.branchName === branch.name || (item.detail?.includes(branch.name) ?? false))
  const notReconciling = goods.rows.filter(row => !row.balanced || row.matchesStock === false).length
  const usedValue = new Prisma.Decimal(materials.totals.usedInProductionValue).add(materials.totals.usedInConversionsValue)
  const several = !branch

  return {
    figures: [
      { label: 'Finished goods at close', value: t.closing,                     kind: 'peso', note: 'At each lot\'s recorded cost' },
      { label: 'Produced',                value: t.produced,                    kind: 'peso' },
      { label: 'Sold',                    value: negate(t.sold),                kind: 'peso', note: 'At cost' },
      { label: 'Written off',             value: negate(t.writtenOff),          kind: 'peso' },
      { label: 'Transferred (net)',       value: t.distributed,                 kind: 'peso', note: several ? 'Across all branches: what was lost in transit' : 'In − out' },
      { label: 'Raw materials received',  value: materials.totals.receivedValue, kind: 'peso', note: 'At purchase cost' },
      { label: 'Raw materials used',      value: toDecimalString(usedValue.neg()), kind: 'peso', note: 'At reference prices' },
      { label: 'Waiting for approval',    value: waiting.length,                kind: 'count', note: 'Now, not at the close' },
      { label: 'Rows not reconciling',    value: notReconciling,                kind: 'count', note: notReconciling === 0 ? 'Every good adds up' : 'See the Check column' },
    ],
    tables: [
      {
        title:       'Finished goods',
        description: 'Per good: the day\'s opening, each flow (in +, out −) and the close — the End of Day page\'s figures.',
        columns: [
          ...(several ? [{ key: 'branchName', label: 'Branch', kind: 'text' as const }] : []),
          { key: 'good',         label: 'Good',          kind: 'text' },
          { key: 'unit',         label: 'Unit',          kind: 'text' },
          { key: 'opening',      label: 'Opening',       kind: 'quantity' },
          { key: 'produced',     label: 'Produced',      kind: 'quantity' },
          { key: 'convertedIn',  label: 'Conv. in',      kind: 'quantity' },
          { key: 'convertedOut', label: 'Conv. out',     kind: 'quantity' },
          { key: 'writtenOff',   label: 'Written off',   kind: 'quantity' },
          { key: 'sold',         label: 'Sold',          kind: 'quantity' },
          { key: 'distributed',  label: 'Transferred',   kind: 'quantity' },
          { key: 'closing',      label: 'Closing',       kind: 'quantity' },
          { key: 'closingValue', label: 'Closing value', kind: 'peso' },
          { key: 'check',        label: 'Check',         kind: 'text' },
        ],
        rows: goods.rows.map(row => ({
          branchName:   row.branchName,
          good:         row.finishedGoodName,
          unit:         row.unitAbbreviation,
          opening:      row.opening.quantity,
          produced:     row.produced.quantity,
          convertedIn:  row.convertedIn.quantity,
          convertedOut: row.convertedOut.quantity,
          writtenOff:   row.writtenOff.quantity,
          sold:         row.sold.quantity,
          distributed:  row.distributed.quantity,
          closing:      row.closing.quantity,
          closingValue: row.closing.value,
          check:        !row.balanced ? 'Does not add up' : row.matchesStock === false ? 'Differs from stock' : 'OK',
        })),
        total:     goods.rows.length > 1 ? { [several ? 'branchName' : 'good']: 'Total', closingValue: t.closing } : null,
        emptyText: 'No finished goods on hand or moved this day.',
      },
      {
        title:       'Raw materials',
        description: 'Per material at the kitchen, from the Stock Ledger: opening, received and used (in +, out −), closing. Outlets hold no raw materials.',
        columns: [
          ...(several ? [{ key: 'branchName', label: 'Kitchen', kind: 'text' as const }] : []),
          { key: 'materialName',      label: 'Material',      kind: 'text' },
          { key: 'unitAbbreviation',  label: 'Unit',          kind: 'text' },
          { key: 'opening',           label: 'Opening',       kind: 'quantity' },
          { key: 'received',          label: 'Received',      kind: 'quantity' },
          { key: 'usedInProduction',  label: 'Used, production', kind: 'quantity' },
          { key: 'usedInConversions', label: 'Used, conversions', kind: 'quantity' },
          { key: 'closing',           label: 'Closing',       kind: 'quantity' },
        ],
        rows:      materials.rows.map(row => ({ ...row })),
        total:     null,
        emptyText: branch ? `${branch.name} holds no raw materials.` : 'No raw materials on hand or moved this day.',
      },
      {
        title:       'What moved',
        description: 'Every document behind the finished-goods figures, in the order the stock moved.',
        columns: [
          { key: 'time',     label: 'Time',     kind: 'text' },
          { key: 'document', label: 'Document', kind: 'text' },
          { key: 'flow',     label: 'What',     kind: 'text' },
          { key: 'good',     label: 'Good',     kind: 'text' },
          ...(several ? [{ key: 'branchName', label: 'Branch', kind: 'text' as const }] : []),
          { key: 'quantity', label: 'Quantity', kind: 'quantity' },
          { key: 'unit',     label: 'Unit',     kind: 'text' },
          { key: 'value',    label: 'Value',    kind: 'peso' },
        ],
        rows: goods.documents.map(doc => ({
          time:       timeOf(doc.movedAt),
          document:   doc.source.number ?? doc.source.type,
          flow:       FLOW_WORDS[doc.flow] ?? doc.flow,
          good:       doc.finishedGoodName,
          branchName: doc.branchName,
          quantity:   doc.quantity,
          unit:       doc.unitAbbreviation,
          value:      doc.value,
        })),
        total:     null,
        emptyText: 'No finished goods moved this day.',
      },
      {
        title:       'Waiting for approval',
        description: 'Documents still waiting for accounting now — at this branch, or to or from it. Oldest first.',
        columns: [
          { key: 'type',    label: 'Type',    kind: 'text' },
          { key: 'number',  label: 'Number',  kind: 'text' },
          { key: 'title',   label: 'What',    kind: 'text' },
          ...(several ? [{ key: 'branchName', label: 'Branch', kind: 'text' as const }] : []),
          { key: 'waiting', label: 'Waiting', kind: 'text' },
        ],
        rows: waiting.map(item => ({
          type:       APPROVAL_TYPE_LABELS[item.type].one,
          number:     item.number,
          title:      item.title,
          branchName: item.branchName,
          waiting:    item.pendingSince ? formatWaited(now - Date.parse(item.pendingSince)) : null,
        })),
        total:     null,
        emptyText: 'Nothing is waiting for approval.',
      },
    ],
    notes: [
      'The day runs midnight to midnight, Manila. Stock moves when its document is approved, so something approved tomorrow for today still lands on tomorrow.',
      'Raw materials are not valued as stock; received and used are the movements\' own values, as on the Stock Ledger.',
      ROUNDING_NOTE,
    ],
  }
}
