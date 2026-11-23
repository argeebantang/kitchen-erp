import { PurchaseRequestService } from '@/services/purchase-request.service'
import { PurchaseOrderService } from '@/services/purchase-order.service'
import { ReceivingReportService } from '@/services/receiving-report.service'
import { ProductionOrderService } from '@/services/production-order.service'
import { ConversionOrderService } from '@/services/conversion-order.service'
import { WriteOffService } from '@/services/write-off.service'
import { StockTransferService } from '@/services/stock-transfer.service'
import { formatQuantity, trimDecimal } from '@/lib/format'
import { shortDateLabel } from '@/lib/dates'

/**
 * The unified approvals inbox (Week 11 Task 1): everything waiting for
 * accounting, in one queue, oldest first.
 *
 * Built from each document's own pending list — the same calls, and so the
 * same stock, price and variance checks, as the per-type tables this replaces.
 * Nothing here works a figure out a second time: it only puts each document's
 * figures into one row shape. Deciding goes through POST /api/approvals, as
 * before, so every service's own rules (self-approval, still pending, a
 * reason to reject, stock re-checked under lock) still hold.
 */

/** Every kind of document /api/approvals decides, in the inbox's order for the filter chips. */
export const APPROVAL_TYPES = [
  'PurchaseRequest',
  'PurchaseOrder',
  'ReceivingReport',
  'ProductionOrder',
  'ProductionCompletion',
  'ConversionOrder',
  'WriteOff',
  'StockTransfer',
] as const

export type ApprovalType = (typeof APPROVAL_TYPES)[number]

export const APPROVAL_TYPE_LABELS: Record<ApprovalType, { one: string; many: string }> = {
  PurchaseRequest:      { one: 'Purchase request',      many: 'Purchase requests' },
  PurchaseOrder:        { one: 'Purchase order',        many: 'Purchase orders' },
  ReceivingReport:      { one: 'Receiving report',      many: 'Receiving reports' },
  ProductionOrder:      { one: 'Production plan',       many: 'Production plans' },
  ProductionCompletion: { one: 'Production completion', many: 'Production completions' },
  ConversionOrder:      { one: 'Conversion',            many: 'Conversions' },
  WriteOff:             { one: 'Write-off',             many: 'Write-offs' },
  StockTransfer:        { one: 'Transfer',              many: 'Transfers' },
}

/** How many of each kind the inbox loads — the same cap as the per-type tables had. */
export const INBOX_TAKE_PER_TYPE = 100

/** Waiting this long or more is overdue: the row is marked, and Task 3's escalation re-notifies. */
export const OVERDUE_HOURS = 24

/** A check the approver should see before deciding — what the per-type tables showed as a badge. */
export type ApprovalFlagDto = { tone: 'ok' | 'warn' | 'bad'; label: string }

export type ApprovalItemDto = {
  type: ApprovalType
  id: string
  number: string
  /** The document's own page, for the full detail. */
  href: string
  /** What it is, in a line: "Lechon — 40 kg". */
  title: string
  detail: string | null
  branchName: string | null
  /** Pesos as a decimal string; null when the document has no single value. */
  amount: string | null
  /** What the amount is: "Est. total", "Total", "Unit cost"… */
  amountLabel: string | null
  /** Set when the amount is per unit ("kg"). */
  amountPer: string | null
  flags: ApprovalFlagDto[]
  submittedByName: string | null
  /** Who submitted, counted or reported it — nobody decides their own (Task 3's reminders skip them too). */
  submittedById: string | null
  /** The viewer submitted, counted or reported it — the service refuses their decision, so the row offers none. */
  mine: boolean
  /** ISO; null for a document submitted before submittedAt existed. */
  pendingSince: string | null
}

export type ApprovalInboxDto = {
  items: ApprovalItemDto[]
  /** Per type, every pending one — can exceed what `items` holds when a type is past INBOX_TAKE_PER_TYPE. */
  counts: Record<ApprovalType, number>
  total: number
  /** Some type had more than INBOX_TAKE_PER_TYPE waiting; its oldest are shown. */
  truncated: boolean
}

type Viewer = { userId: string; role: string }

const lines = (count: number) => `${count} line${count === 1 ? '' : 's'}`

/** Oldest first; an undated (pre-Week 11) document goes last, by number. */
function byWaitingLongest(a: ApprovalItemDto, b: ApprovalItemDto): number {
  if (a.pendingSince && b.pendingSince) return a.pendingSince.localeCompare(b.pendingSince)
  if (a.pendingSince) return -1
  if (b.pendingSince) return 1
  return a.number.localeCompare(b.number)
}

export const ApprovalInboxService = {
  async list(viewer: Viewer): Promise<ApprovalInboxDto> {
    const take = INBOX_TAKE_PER_TYPE
    const [requests, orders, receiving, plans, completions, conversions, writeOffs, transfers] = await Promise.all([
      PurchaseRequestService.list(viewer, { status: 'PENDING_APPROVAL', take }),
      PurchaseOrderService.list({ status: 'PENDING_APPROVAL', take }),
      ReceivingReportService.list({ status: 'PENDING_APPROVAL', take }),
      ProductionOrderService.listPending(take),
      ProductionOrderService.listPendingCompletions(take),
      ConversionOrderService.listPending(take),
      WriteOffService.listPending(take),
      StockTransferService.listPending(take),
    ])

    const items: ApprovalItemDto[] = [
      ...requests.purchaseRequests.map<ApprovalItemDto>(row => ({
        type:            'PurchaseRequest',
        id:              row.id,
        number:          row.prNumber,
        href:            `/procurement/requests/${row.id}`,
        title:           `${lines(row.lineCount)}${row.deliverToName ? ` for ${row.deliverToName}` : ''}`,
        detail:          row.neededBy ? `Needed by ${shortDateLabel(row.neededBy.slice(0, 10))}` : null,
        branchName:      row.deliverToName,
        amount:          row.estimatedTotal,
        amountLabel:     row.estimatedTotal === null ? null : 'Est. total',
        amountPer:       null,
        flags:           row.estimatedTotal === null ? [{ tone: 'warn', label: 'Not priced' }] : [],
        submittedByName: row.requesterName,
        submittedById:   row.requestedById,
        mine:            row.requestedById === viewer.userId,
        pendingSince:    row.submittedAt,
      })),

      ...orders.purchaseOrders.map<ApprovalItemDto>(row => ({
        type:            'PurchaseOrder',
        id:              row.id,
        number:          row.poNumber,
        href:            `/procurement/orders/${row.id}`,
        title:           `${row.supplierName ?? 'No supplier'} · ${lines(row.lineCount)}`,
        detail:          [
          row.prNumber ? `From ${row.prNumber}` : null,
          row.expectedDelivery ? `delivery ${shortDateLabel(row.expectedDelivery.slice(0, 10))}` : null,
        ].filter(part => part !== null).join(', ') || null,
        branchName:      null,
        amount:          row.totalAmount,
        amountLabel:     'Total',
        amountPer:       null,
        flags:           [],
        submittedByName: row.submittedByName,
        submittedById:   row.submittedById,
        mine:            row.submittedById === viewer.userId,
        pendingSince:    row.submittedAt,
      })),

      ...receiving.receivingReports.map<ApprovalItemDto>(row => ({
        type:            'ReceivingReport',
        id:              row.id,
        number:          row.rrNumber,
        href:            `/procurement/receiving/${row.id}`,
        title:           `${row.supplierName ?? 'No supplier'} · ${row.poNumber}`,
        detail:          `${lines(row.lineCount)} received ${shortDateLabel(row.receivedAt.slice(0, 10))}`,
        branchName:      row.branchName,
        amount:          row.acceptedValue,
        amountLabel:     'Accepted',
        amountPer:       null,
        flags:           row.varianceLineCount > 0
          ? [{ tone: 'warn', label: `${row.varianceLineCount} ${row.varianceLineCount === 1 ? 'line differs' : 'lines differ'} from the order` }]
          : [{ tone: 'ok', label: 'As ordered' }],
        submittedByName: row.receivedByName,
        submittedById:   row.receivedById,
        mine:            row.receivedById === viewer.userId,
        pendingSince:    row.submittedAt,
      })),

      ...plans.map<ApprovalItemDto>(row => ({
        type:            'ProductionOrder',
        id:              row.id,
        number:          row.orderNumber,
        href:            `/production/orders/${row.id}`,
        title:           `${row.finishedGoodName} — ${trimDecimal(row.plannedQty)} ${row.unitAbbreviation}`,
        detail:          `Planned for ${shortDateLabel(row.plannedDate)}`,
        branchName:      row.branchName,
        amount:          null,
        amountLabel:     null,
        amountPer:       null,
        // Right now, at the order's branch — the order page lists which.
        flags:           row.shortCount === 0
          ? [{ tone: 'ok', label: 'In stock' }]
          : [{ tone: 'bad', label: `Short · ${row.shortCount} of ${row.ingredientCount}` }],
        submittedByName: row.submittedByName,
        submittedById:   row.submittedById,
        mine:            row.submittedById === viewer.userId,
        pendingSince:    row.pendingSince,
      })),

      ...completions.map<ApprovalItemDto>(row => ({
        type:            'ProductionCompletion',
        id:              row.id,
        number:          row.orderNumber,
        href:            `/production/orders/${row.id}`,
        title:           `${row.finishedGoodName} — ${trimDecimal(row.actualQty)} of ${trimDecimal(row.plannedQty)} ${row.unitAbbreviation}`,
        detail:          `${row.percentOfPlan}% of plan`,
        branchName:      row.branchName,
        amount:          row.costPerUnit,
        amountLabel:     row.costPerUnit === null ? null : 'Unit cost',
        amountPer:       row.costPerUnit === null ? null : row.unitAbbreviation,
        // What approving would record and leave at the branch — the order page has the breakdown.
        flags:           [
          ...(row.costPerUnit === null ? [{ tone: 'bad' as const, label: 'Price missing' }] : []),
          row.negativeCount === 0
            ? { tone: 'ok' as const, label: 'All in stock' }
            : { tone: 'bad' as const, label: `${row.negativeCount} of ${row.ingredientCount} go negative` },
        ],
        submittedByName: row.completedByName,
        submittedById:   row.completedById,
        mine:            row.completedById === viewer.userId,
        pendingSince:    row.pendingSince,
      })),

      ...conversions.map<ApprovalItemDto>(row => ({
        type:            'ConversionOrder',
        id:              row.id,
        number:          row.orderNumber,
        href:            `/production/conversions/${row.id}`,
        title:           `${formatQuantity(row.outputQty)} ${row.unitAbbreviation} ${row.finishedGoodName} from ${formatQuantity(row.sourceQty)} ${row.sourceUnitAbbreviation} ${row.sourceName}`,
        detail:          `${row.percentOfExpected}% of expected`,
        branchName:      row.branchName,
        amount:          row.missingPrices > 0 ? null : row.costPerUnit,
        amountLabel:     row.missingPrices > 0 || row.costPerUnit === null ? null : 'Unit cost',
        amountPer:       row.missingPrices > 0 || row.costPerUnit === null ? null : row.unitAbbreviation,
        // The source must be there to approve; ingredients may go negative.
        flags:           [
          ...(row.missingPrices > 0 ? [{ tone: 'bad' as const, label: 'Price missing' }] : []),
          !row.sourceEnough
            ? { tone: 'bad' as const, label: `${row.sourceName} short` }
            : row.negativeCount === 0
              ? { tone: 'ok' as const, label: 'All in stock' }
              : { tone: 'warn' as const, label: `${row.negativeCount} of ${row.ingredientCount} go negative` },
        ],
        submittedByName: row.submittedByName,
        submittedById:   row.submittedById,
        mine:            row.submittedById === viewer.userId,
        pendingSince:    row.createdAt,
      })),

      ...writeOffs.map<ApprovalItemDto>(row => ({
        type:            'WriteOff',
        id:              row.id,
        number:          row.writeOffNumber,
        href:            `/inventory/write-offs/${row.id}`,
        title:           `${formatQuantity(row.quantity)} ${row.unitAbbreviation} ${row.finishedGoodName}`,
        detail:          `${row.reasonLabel} · lot ${row.lotNumber}`,
        branchName:      row.branchName,
        amount:          row.value,
        amountLabel:     row.value === null ? null : 'Value',
        amountPer:       null,
        flags:           row.enough ? [{ tone: 'ok', label: 'Lot holds it' }] : [{ tone: 'bad', label: 'Lot short' }],
        submittedByName: row.submittedByName,
        submittedById:   row.submittedById,
        mine:            row.submittedById === viewer.userId,
        pendingSince:    row.createdAt,
      })),

      ...transfers.map<ApprovalItemDto>(row => ({
        type:            'StockTransfer',
        id:              row.id,
        number:          row.transferNumber,
        href:            `/inventory/transfers/${row.id}`,
        title:           row.lines.map(line => `${line.finishedGoodName} ${formatQuantity(line.quantity)} ${line.unitAbbreviation}`).join(', '),
        detail:          `${row.fromBranch.name} → ${row.toBranch.name}`,
        branchName:      row.fromBranch.name,
        // At the cost of the lots approving now would send.
        amount:          row.totalValue,
        amountLabel:     row.totalValue === null ? null : 'Value',
        amountPer:       null,
        flags:           row.allEnough ? [{ tone: 'ok', label: 'In stock' }] : [{ tone: 'bad', label: 'Short' }],
        submittedByName: row.submittedByName,
        submittedById:   row.submittedById,
        mine:            row.submittedById === viewer.userId,
        pendingSince:    row.createdAt,
      })),
    ]

    // The five lists without a total stop at `take`: reaching it means there may be more.
    const counts: Record<ApprovalType, number> = {
      PurchaseRequest:      requests.total,
      PurchaseOrder:        orders.total,
      ReceivingReport:      receiving.total,
      ProductionOrder:      plans.length,
      ProductionCompletion: completions.length,
      ConversionOrder:      conversions.length,
      WriteOff:             writeOffs.length,
      StockTransfer:        transfers.length,
    }
    const shown = (type: ApprovalType) => items.filter(item => item.type === type).length
    const truncated = APPROVAL_TYPES.some(type => counts[type] > shown(type))
      || [plans, completions, conversions, writeOffs, transfers].some(list => list.length >= take)

    return {
      items:  items.sort(byWaitingLongest),
      counts,
      total:  APPROVAL_TYPES.reduce((sum, type) => sum + counts[type], 0),
      truncated,
    }
  },
}
