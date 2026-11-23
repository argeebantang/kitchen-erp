import { Prisma } from '@prisma/client'
import { toDecimalString } from '@/lib/decimal'
import { businessDayRange, addDays } from '@/lib/dates'
import { EndOfDayService } from '@/services/end-of-day.service'
import { InventoryService } from '@/services/inventory.service'
import { SupplierPerformanceService } from '@/services/supplier-performance.service'
import { WastePatternService } from '@/services/waste-pattern.service'
import { ApprovalRepository } from '@/repositories/approval.repository'
import { PurchaseOrderRepository } from '@/repositories/purchase-order.repository'
import { ROUNDING_NOTE } from '@/services/production-report.service'
import type { ReportDto, ReportParams } from '@/services/report.service'

/**
 * Inventory Movement, Procurement and Waste & Write-off (Week 11 Task 5).
 * Each figure comes from the service that already computes it — End of Day
 * (finished goods), the Stock Ledger (raw materials), Supplier Performance
 * and the Waste Pattern figures, each now able to take any period — so these
 * builders only arrange them. The only new sums are what no page showed
 * before: purchase orders approved and purchase requests decided in a period.
 */

type Built = Pick<ReportDto, 'figures' | 'tables' | 'notes'>

const zero = new Prisma.Decimal(0)
const negate = (value: string) => toDecimalString(new Prisma.Decimal(value).neg())

// ─── Inventory Movement ───────────────────────────────────────────────────────

export async function inventoryMovementReport({ from, to, branch }: ReportParams): Promise<Built> {
  const [goods, materials] = await Promise.all([
    EndOfDayService.forPeriod(from, to, branch?.id ?? null),
    InventoryService.materialFlows(from, to, branch?.id ?? null),
  ])
  const t = goods.totals
  const goodsOther = goods.rows.some(row => !new Prisma.Decimal(row.other.quantity).isZero())
  const materialsOther = materials.rows.some(row => !new Prisma.Decimal(row.other).isZero())

  return {
    figures: [
      { label: 'Finished goods, opening', value: t.opening,                   kind: 'peso', note: 'At each lot\'s recorded cost' },
      { label: 'Produced',                value: t.produced,                  kind: 'peso' },
      { label: 'Sold at outlets',         value: negate(t.sold),              kind: 'peso', note: 'At cost' },
      { label: 'Written off',             value: negate(t.writtenOff),        kind: 'peso' },
      { label: 'Finished goods, closing', value: t.closing,                   kind: 'peso' },
      { label: 'Raw materials received',  value: materials.totals.receivedValue, kind: 'peso', note: 'At purchase cost' },
      { label: 'Raw materials used',      value: negate(toDecimalString(new Prisma.Decimal(materials.totals.usedInProductionValue).add(materials.totals.usedInConversionsValue))), kind: 'peso', note: 'In production and conversions, at reference prices' },
      { label: 'Stock movements',         value: goods.movementCount + materials.movementCount, kind: 'count' },
    ],
    tables: [
      {
        title:       'Finished goods',
        description: 'Per good and branch: the opening balance, each flow in the period (in +, out −) and the closing balance — End of Day\'s figures over the whole period. Distributed = transfers between branches.',
        columns: [
          { key: 'branchName',   label: 'Branch',        kind: 'text' },
          { key: 'good',         label: 'Good',          kind: 'text' },
          { key: 'unit',         label: 'Unit',          kind: 'text' },
          { key: 'opening',      label: 'Opening',       kind: 'quantity' },
          { key: 'produced',     label: 'Produced',      kind: 'quantity' },
          { key: 'convertedIn',  label: 'Converted in',  kind: 'quantity' },
          { key: 'convertedOut', label: 'Converted out', kind: 'quantity' },
          { key: 'writtenOff',   label: 'Written off',   kind: 'quantity' },
          { key: 'sold',         label: 'Sold',          kind: 'quantity' },
          { key: 'distributed',  label: 'Distributed',   kind: 'quantity' },
          ...(goodsOther ? [{ key: 'other', label: 'Other', kind: 'quantity' as const }] : []),
          { key: 'closing',      label: 'Closing',       kind: 'quantity' },
          { key: 'closingValue', label: 'Closing value', kind: 'peso' },
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
          other:        row.other.quantity,
          closing:      row.closing.quantity,
          closingValue: row.closing.value,
        })),
        total:     goods.rows.length > 1 ? { branchName: 'Total', closingValue: t.closing } : null,
        emptyText: 'No finished goods on hand or moved in this period.',
      },
      {
        title:       'Raw materials',
        description: 'Per material and kitchen, from the Stock Ledger: the opening balance, what was received and used (in +, out −) and the closing balance. Values are the movements\' own, as the ledger shows them; raw stock itself is not valued. Outlets hold no raw materials.',
        columns: [
          { key: 'branchName',             label: 'Kitchen',             kind: 'text' },
          { key: 'materialName',           label: 'Material',            kind: 'text' },
          { key: 'unitAbbreviation',       label: 'Unit',                kind: 'text' },
          { key: 'opening',                label: 'Opening',             kind: 'quantity' },
          { key: 'received',               label: 'Received',            kind: 'quantity' },
          { key: 'usedInProduction',       label: 'Used in production',  kind: 'quantity' },
          { key: 'usedInConversions',      label: 'Used in conversions', kind: 'quantity' },
          ...(materialsOther ? [{ key: 'other', label: 'Other', kind: 'quantity' as const }] : []),
          { key: 'closing',                label: 'Closing',             kind: 'quantity' },
          { key: 'receivedValue',          label: 'Received value',      kind: 'peso' },
          { key: 'usedValue',              label: 'Used value',          kind: 'peso' },
        ],
        rows: materials.rows.map(row => ({
          ...row,
          usedValue: row.usedInProductionValue === null && row.usedInConversionsValue === null
            ? null
            : toDecimalString(new Prisma.Decimal(row.usedInProductionValue ?? 0).add(row.usedInConversionsValue ?? 0)),
        })),
        total: materials.rows.length > 1
          ? {
              branchName: 'Total',
              receivedValue: materials.totals.receivedValue,
              usedValue: toDecimalString(new Prisma.Decimal(materials.totals.usedInProductionValue).add(materials.totals.usedInConversionsValue)),
            }
          : null,
        emptyText: branch ? `${branch.name} holds no raw materials in this period.` : 'No raw materials on hand or moved in this period.',
      },
    ],
    notes: [
      'Stock moves when its document is approved; a document approved late moves stock on the day it was approved, so a past period can still change.',
      ROUNDING_NOTE,
    ],
  }
}

// ─── Procurement ──────────────────────────────────────────────────────────────

export async function procurementReport({ from, to }: ReportParams): Promise<Built> {
  const start = businessDayRange(from).start
  const end = businessDayRange(addDays(to, 1)).start
  const [suppliers, ordered, requestDecisions] = await Promise.all([
    SupplierPerformanceService.periodFacts(from, to),
    PurchaseOrderRepository.approvedBySupplierBetween(start, end),
    ApprovalRepository.decisionCountsBetween('PurchaseRequest', start, end),
  ])
  const orderCount = ordered.reduce((sum, row) => sum + Number(row.orders), 0)
  const orderValue = ordered.reduce((sum, row) => sum.add(row.value ?? zero), zero)
  const requests = (decision: string) => requestDecisions.find(row => row.decision === decision)?.count ?? 0

  return {
    figures: [
      { label: 'Orders approved',      value: orderCount,                         kind: 'count' },
      { label: 'Value ordered',        value: toDecimalString(orderValue),        kind: 'peso', note: 'Purchase orders approved in the period' },
      { label: 'Deliveries',           value: suppliers.totals.deliveries,        kind: 'count', note: 'Receiving reports approved, by delivery date' },
      { label: 'Received',             value: suppliers.totals.receivedValue,     kind: 'peso' },
      { label: 'Short',                value: suppliers.totals.shortValue,        kind: 'peso', note: 'What did not come, at the order\'s cost' },
      { label: 'Rejected at delivery', value: suppliers.totals.rejectedValue,     kind: 'peso' },
      { label: 'Flagged suppliers',    value: suppliers.totals.flaggedSuppliers,  kind: 'count', note: 'Often short or late — rule below' },
      { label: 'Requests approved',    value: requests('APPROVED'),               kind: 'count', note: `${requests('REJECTED')} rejected` },
    ],
    tables: [
      {
        title:       'Orders approved, by supplier',
        description: 'Purchase orders approved in the period, by the time of approval.',
        columns: [
          { key: 'supplier', label: 'Supplier', kind: 'text' },
          { key: 'orders',   label: 'Orders',   kind: 'count' },
          { key: 'value',    label: 'Value',    kind: 'peso' },
        ],
        rows:      ordered.map(row => ({ supplier: row.supplierName ?? 'No supplier', orders: Number(row.orders), value: row.value === null ? null : toDecimalString(row.value) })),
        total:     ordered.length > 1 ? { supplier: 'Total', orders: orderCount, value: toDecimalString(orderValue) } : null,
        emptyText: 'No purchase order was approved in this period.',
      },
      {
        title:       'Supplier performance',
        description: 'Deliveries in the period (receiving reports approved, by delivery date): what came, what came short or was rejected, and how late — the Supplier Performance figures over this period.',
        columns: [
          { key: 'supplier',             label: 'Supplier',         kind: 'text' },
          { key: 'deliveries',           label: 'Deliveries',       kind: 'count' },
          { key: 'receivedValue',        label: 'Received',         kind: 'peso' },
          { key: 'shortDeliveryPct',     label: 'Short deliveries', kind: 'percent' },
          { key: 'shortValue',           label: 'Short value',      kind: 'peso' },
          { key: 'rejectedValue',        label: 'Rejected',         kind: 'peso' },
          { key: 'lateOrderPct',         label: 'Late orders',      kind: 'percent' },
          { key: 'avgDaysLate',          label: 'Avg days late',    kind: 'quantity' },
          { key: 'promisedLeadTimeDays', label: 'Lead time promised (d)', kind: 'count' },
          { key: 'measuredLeadTimeDays', label: 'Lead time actual (d)',   kind: 'count' },
          { key: 'flags',                label: 'Flagged',          kind: 'text' },
        ],
        rows: suppliers.suppliers.map(({ flagReasons, ...row }) => ({ ...row, flags: flagReasons.join('; ') || null })),
        total: suppliers.suppliers.length > 1
          ? { supplier: 'Total', deliveries: suppliers.totals.deliveries, receivedValue: suppliers.totals.receivedValue, shortValue: suppliers.totals.shortValue, rejectedValue: suppliers.totals.rejectedValue }
          : null,
        emptyText: 'No delivery was approved in this period.',
      },
      {
        title:       'Materials that came short',
        description: 'Per supplier and material, the lines that came short and what was missing.',
        columns: [
          { key: 'supplier',     label: 'Supplier',    kind: 'text' },
          { key: 'material',     label: 'Material',    kind: 'text' },
          { key: 'lines',        label: 'Lines',       kind: 'count' },
          { key: 'shortLines',   label: 'Short lines', kind: 'count' },
          { key: 'shortLinePct', label: 'Short',       kind: 'percent' },
          { key: 'shortQty',     label: 'Missing',     kind: 'quantity' },
          { key: 'unit',         label: 'Unit',        kind: 'text' },
          { key: 'shortValue',   label: 'Value',       kind: 'peso' },
        ],
        rows:      suppliers.materials.filter(row => row.shortLines > 0).map(row => ({ ...row })),
        total:     null,
        emptyText: 'Nothing came short in this period.',
      },
    ],
    notes: [suppliers.flagRule, ROUNDING_NOTE],
  }
}

// ─── Waste & Write-off ────────────────────────────────────────────────────────

export async function wasteReport({ from, to, branch }: ReportParams): Promise<Built> {
  const facts = await WastePatternService.periodFigures(from, to, branch?.name ?? null)
  const t = facts.totals
  const previousLabel = `the ${facts.days} day${facts.days === 1 ? '' : 's'} before`

  return {
    figures: [
      { label: 'Written off',           value: t.writtenOffValue,    kind: 'peso',     note: 'At each lot\'s cost' },
      { label: 'Written off (kg)',      value: t.writtenOffKg,       kind: 'quantity' },
      { label: 'Lost in transit',       value: t.lostInTransitValue, kind: 'peso',     note: 'Deliveries that arrived short' },
      { label: 'Lost in all',           value: t.lostValue,          kind: 'peso' },
      ...(branch ? [] : [{ label: 'Share of production cost', value: t.lostPctOfProductionCost, kind: 'percent' as const, note: `Of ₱ produced: ${t.productionCost}` }]),
      { label: 'Written off, before',   value: t.previousWrittenOffValue, kind: 'peso', note: `In ${previousLabel}` },
      { label: 'Change',                value: t.writtenOffChangePct, kind: 'percent', note: `Against ${previousLabel}` },
    ],
    tables: [
      {
        title:       'By branch',
        description: 'Each branch\'s write-offs, all goods together. Waste % is of what came in (made at a kitchen, delivered to an outlet).',
        columns: [
          { key: 'branch',                  label: 'Branch',        kind: 'text' },
          { key: 'branchType',              label: 'Type',          kind: 'text' },
          { key: 'writeOffs',               label: 'Write-offs',    kind: 'count' },
          { key: 'writtenOffKg',            label: 'Kg',            kind: 'quantity' },
          { key: 'writtenOffValue',         label: 'Value',         kind: 'peso' },
          { key: 'sharePctOfWrittenOff',    label: 'Share',         kind: 'percent' },
          { key: 'wastePctOfCameIn',        label: 'Waste %',       kind: 'percent' },
          { key: 'biggestGood',             label: 'Most wasted',   kind: 'text' },
          { key: 'previousWrittenOffValue', label: 'Before',        kind: 'peso' },
          { key: 'changePct',               label: 'Change',        kind: 'percent' },
        ],
        rows:      facts.branches.map(row => ({ ...row })),
        total:     facts.branches.length > 1 ? { branch: 'Total', writtenOffKg: t.writtenOffKg, writtenOffValue: t.writtenOffValue, previousWrittenOffValue: t.previousWrittenOffValue, changePct: t.writtenOffChangePct } : null,
        emptyText: 'Nothing was written off in this period.',
      },
      {
        title:       'By branch and good',
        description: 'Every branch-and-good pair with write-offs, costliest first: on how many days, the reasons (kg), and the waste against what came in.',
        columns: [
          { key: 'branch',            label: 'Branch',      kind: 'text' },
          { key: 'good',              label: 'Good',        kind: 'text' },
          { key: 'writeOffs',         label: 'Write-offs',  kind: 'count' },
          { key: 'daysWithWriteOffs', label: 'Days',        kind: 'count' },
          { key: 'writtenOffKg',      label: 'Kg',          kind: 'quantity' },
          { key: 'writtenOffValue',   label: 'Value',       kind: 'peso' },
          { key: 'reasons',           label: 'Reasons (kg)', kind: 'text' },
          { key: 'cameInKg',          label: 'Came in (kg)', kind: 'quantity' },
          { key: 'wastePctOfCameIn',  label: 'Waste %',     kind: 'percent' },
          { key: 'changePct',         label: 'Change',      kind: 'percent' },
        ],
        rows: facts.rows.map(({ byReason, ...row }) => ({
          ...row,
          reasons: Object.entries(byReason).map(([reason, kg]) => `${reason} ${kg}`).join(', '),
        })),
        total:     null,
        emptyText: 'Nothing was written off in this period.',
      },
      {
        title:       'Lost in transit',
        description: 'Delivery routes where goods arrived short.',
        columns: [
          { key: 'route',              label: 'Route',           kind: 'text' },
          { key: 'deliveries',         label: 'Deliveries',      kind: 'count' },
          { key: 'deliveriesWithLoss', label: 'With a loss',     kind: 'count' },
          { key: 'lostKg',             label: 'Kg',              kind: 'quantity' },
          { key: 'lostValue',          label: 'Value',           kind: 'peso' },
          { key: 'reasons',            label: 'Reasons',         kind: 'text' },
        ],
        rows:      facts.routes.map(row => ({ ...row, reasons: row.reasons.join(', ') })),
        total:     facts.routes.length > 1 ? { route: 'Total', lostValue: t.lostInTransitValue } : null,
        emptyText: 'Every delivery arrived complete.',
      },
      {
        title:       'Recovered in conversions',
        description: 'Unsold goods made into another dish instead of thrown away — not waste.',
        columns: [
          { key: 'kitchen',     label: 'Kitchen',     kind: 'text' },
          { key: 'conversions', label: 'Conversions', kind: 'count' },
          { key: 'from',        label: 'From',        kind: 'text' },
          { key: 'convertedKg', label: 'Kg used',     kind: 'quantity' },
          { key: 'into',        label: 'Into',        kind: 'text' },
          { key: 'madeKg',      label: 'Kg made',     kind: 'quantity' },
        ],
        rows:      facts.recovered.map(row => ({ ...row })),
        total:     null,
        emptyText: 'No conversion in this period.',
      },
    ],
    notes: [
      `The same figures as the weekly waste report (KitchenAI), over this period, compared with ${previousLabel}. A write-off counts on the day it was recorded, a transit loss on the day the delivery was received.`,
      ROUNDING_NOTE,
    ],
  }
}
