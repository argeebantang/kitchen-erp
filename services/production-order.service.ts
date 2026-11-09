import { Prisma, ProductionStatus } from '@prisma/client'
import { toDecimal, toDecimalString } from '@/lib/decimal'
import { isoDateAt, todayIsoDate } from '@/lib/dates'
import {
  getNotificationQueue,
  PRODUCTION_COMPLETION_DECIDED,
  PRODUCTION_COMPLETION_REPORTED,
  PRODUCTION_ORDER_DECIDED,
  PRODUCTION_ORDER_SUBMITTED,
  type ProductionOrderJob,
} from '@/lib/queue'
import { trimDecimal } from '@/lib/format'
import { BomRepository, BomWithDetail } from '@/repositories/bom.repository'
import { scaleBomQuantities } from '@/services/bom.service'
import { BranchRepository } from '@/repositories/branch.repository'
import { InventoryRepository } from '@/repositories/inventory.repository'
import { FinishedGoodStockRepository } from '@/repositories/finished-good-stock.repository'
import { ItemPriceRepository } from '@/repositories/item-price.repository'
import { FinishedGoodRepository } from '@/repositories/finished-good.repository'
import {
  ProductionOrderListFilters,
  ProductionOrderRepository,
  ProductionOrderWithDetail,
} from '@/repositories/production-order.repository'

/** Upper bound on batches per order: catches a typed 1000 for 10. */
export const MAX_BATCH_COUNT = 100

/**
 * The most a reported yield may be, as a multiple of the planned output
 * (Week 6 Task 1, D3): catches a typed 100 for 10. Above plan is normal — a
 * stew takes on liquid — so the cap is generous.
 */
export const MAX_YIELD_FACTOR = 2

/** A finished good the form can plan, with the BOM version it would pin today. */
export type PlannableGoodDto = {
  finishedGoodId: string
  code: string
  name: string
  bomId: string
  bomVersion: number
  /** The form's default batch weight. */
  batchSize: string
  unitAbbreviation: string
  /**
   * False when the BOM's batch unit differs from the finished good's unit.
   * There is no unit conversion yet, so such an order is refused (D10).
   */
  unitsMatch: boolean
}

export type ProductionOrderFormDto = {
  goods: PlannableGoodDto[]
  branches: { id: string; name: string }[]
}

export type CreateProductionOrderServiceInput = {
  finishedGoodId: string
  batchWeight: string
  batchCount: number
  plannedDate: string
  branchId: string
  notes?: string | null
}

/** An edit sends the same fields as a new order. */
export type UpdateProductionOrderServiceInput = CreateProductionOrderServiceInput

export type ProductionOrderSummaryDto = {
  id: string
  orderNumber: string
  status: ProductionStatus
  finishedGoodId: string
  finishedGoodCode: string
  finishedGoodName: string
  bomId: string
  bomVersion: number
  /** False once a newer version has replaced the pinned one. */
  bomIsActive: boolean
  unitAbbreviation: string
  batchWeight: string
  batchCount: number
  plannedQty: string
  /** YYYY-MM-DD (stored as UTC midnight). */
  plannedDate: string
  branchId: string
  branchName: string
  requestedById: string
  requestedByName: string
  /** Null until the order is submitted. */
  submittedById: string | null
  submittedByName: string | null
  createdAt: string
}

/** Stock against one requirement line, at the order's branch, right now (Task 3, D3). */
export type LineStockDto = {
  onHand: string
  /** Still needed by other APPROVED / IN_PROGRESS orders at the branch. */
  committed: string
  /** onHand − committed. Negative when more is spoken for than is on the shelf. */
  available: string
  /** max(total − max(available, 0), 0): at most the whole requirement, never another order's deficit. */
  short: string
  /** total ≤ available — exactly enough counts as enough (D6). */
  enough: boolean
}

/** One ingredient of an order: its BOM line scaled to the batch weight and to the whole run. */
export type MaterialRequirementDto = {
  materialId: string
  materialCode: string
  materialName: string
  unitAbbreviation: string
  /** For one batch of batchWeight. */
  perBatch: string
  /** For plannedQty (all batches). */
  total: string
  /** Null where the order's status has no stock check (completed, rejected, cancelled). */
  stock: LineStockDto | null
}

/** What a run would need, before it is saved — the form's preview. */
export type RequirementsPreviewDto = {
  /** The active version: the one a save would pin. */
  bomId: string
  bomVersion: number
  batchWeight: string
  batchCount: number
  plannedQty: string
  /** Where the stock was checked. */
  branchName: string
  lines: MaterialRequirementDto[]
}

export type ProductionOrderDetailDto = ProductionOrderSummaryDto & {
  notes: string | null
  updatedAt: string
  /**
   * The version a save would pin now, when it differs from the pinned one —
   * only looked up for a superseded pin. Null if the good has no active BOM.
   */
  activeBomVersion: number | null
  /** The pinned BOM scaled to this order — derived on every read, never stored (Task 2, D1). */
  requirements: MaterialRequirementDto[]
  /** Every status change, oldest first — the timeline (Week 5 Task 6). */
  statusChanges: StatusChangeDto[]
  /** What the kitchen reported it actually yielded; null until completion is reported (Week 6 Task 1). */
  actualYield: ActualYieldDto | null
  /** Who reported the run done, and when (ISO); null until then. */
  completedByName: string | null
  completedAt: string | null
  /** Who reported it, for the "nobody approves their own completion" check on the page. */
  completedById: string | null
  /** While a completion awaits sign-off: what approving will do (Week 6 Task 2). */
  completionEffect: CompletionEffectDto | null
  /** Once completed: what it moved. */
  stockMoved: CompletionStockDto | null
  /** Cost of the run (Week 6 Task 3); null for rejected and cancelled orders. */
  costing: CostingDto | null
}

/**
 * What approving a reported completion will do to the books, shown to the
 * approver before deciding (Week 6 Task 2, D8). Only for PENDING_COMPLETION.
 */
export type CompletionEffectDto = {
  /** One per material, in BOM order, at the planned quantity — exactly what approval deducts. */
  ingredients: {
    materialId: string
    materialCode: string
    materialName: string
    unitAbbreviation: string
    deduct: string
    /** On hand at the branch now. */
    onHand: string
    /** onHand − deduct. */
    after: string
    /** after < 0 — allowed, but the approver is told (D3). */
    goesNegative: boolean
  }[]
  negativeCount: number
  lot: {
    lotNumber: string; quantity: string; unitAbbreviation: string; branchName: string
    /** ISO; null when the finished good has no shelf life — approval is then refused (Week 6 Task 4, D3). */
    expiresAt: string | null
    shelfLifeHours: number | null
  }
}

/**
 * What an approved completion moved, read back from both ledgers so the card
 * shows the books as they are (D8). Only for COMPLETED.
 */
export type CompletionStockDto = {
  ingredients: {
    id: string
    materialId: string
    branchId: string
    materialCode: string
    materialName: string
    unitAbbreviation: string
    /** Signed: negative, out of stock. */
    quantity: string
    /** The price the run was costed at (Week 6 Task 3); null on runs approved before costing. */
    unitCost: string | null
  }[]
  /** Null only if the lot is missing, which approval makes impossible. */
  lot: {
    lotNumber: string; quantity: string; unitAbbreviation: string; producedOn: string; branchName: string
    /** Cost per unit of the lot. */
    unitCost: string | null
    /** ISO; null for a lot made before expiry was tracked. */
    expiresAt: string | null
  } | null
}

/** One ingredient of a costed run: the quantity deducted at the price in force (Week 6 Task 3). */
export type CostLineDto = {
  materialId: string
  materialCode: string
  materialName: string
  unitAbbreviation: string
  quantity: string
  /** Per unit of the material; null when no price is in force on the date. */
  unitPrice: string | null
  /** YYYY-MM-DD the price took effect. */
  priceEffective: string | null
  /** quantity × unitPrice. */
  cost: string | null
}

/** A run priced on one date: its lines and total, or which materials have no price. */
export type RunCostDto = {
  /** The date the prices are taken on, YYYY-MM-DD. */
  pricedOn: string
  lines: CostLineDto[]
  /** Null while any line has no price (D5). */
  total: string | null
  /** total ÷ the quantity it is spread over (planned or actual yield). */
  perUnit: string | null
  /** Material names with no price on the date. */
  missing: string[]
}

/**
 * The order page's Costing card (Week 6 Task 3, D7):
 *   ESTIMATE  open order — the planned cost only
 *   PENDING   completion awaiting sign-off — what approving would record
 *   RECORDED  completed — the figures stored at approval (D4)
 */
export type CostingDto = {
  kind: 'ESTIMATE' | 'PENDING' | 'RECORDED'
  unitAbbreviation: string
  plannedQty: string
  /** At reference prices on the production date, spread over the planned quantity. */
  planned: RunCostDto
  /** At prices on the lot's production date, spread over the actual yield. Null for an estimate. */
  actual: (RunCostDto & { yield: string }) | null
  /** actual − planned per unit × actual yield. Positive = over plan. */
  variance: string | null
}

/** The actual yield against the planned output, in the order's unit (Week 6 Task 1, D5). */
export type ActualYieldDto = {
  actualQty: string
  /** actualQty − plannedQty: negative when the run came out short. */
  difference: string
  /** actualQty ÷ plannedQty × 100, to one decimal place — "96" or "103.5". */
  percentOfPlan: string
}

export type StatusChangeDto = {
  id: string
  fromStatus: ProductionStatus
  toStatus: ProductionStatus
  changedByName: string
  /** Approval remarks or the cancel reason. */
  note: string | null
  /** ISO timestamp. */
  at: string
}

/** A row of the approvals inbox: the order plus how many ingredients are short right now. */
export type PendingProductionOrderDto = ProductionOrderSummaryDto & {
  ingredientCount: number
  shortCount: number
}

/** A reported completion in the approvals inbox (Week 6 Task 2, D9). */
export type PendingCompletionDto = ProductionOrderSummaryDto & {
  actualQty: string
  /** actualQty ÷ plannedQty × 100, one decimal place. */
  percentOfPlan: string
  completedByName: string | null
  ingredientCount: number
  /** Ingredients approval would take below zero at the branch. */
  negativeCount: number
  /** What approving records as the cost per unit; null while a price is missing (Week 6 Task 3). */
  costPerUnit: string | null
}

/** What "Request missing materials" pre-fills on a new purchase request (Task 4, D3). */
export type ShortfallRequestDto = {
  productionOrderId: string
  orderNumber: string
  /** The production date: the materials are needed by then. */
  neededBy: string
  notes: string
  /** One per short material, at exactly the short quantity — the requester rounds up if they wish. */
  lines: { materialId: string; quantity: string }[]
}

/** One day of the schedule calendar (Week 5 Task 7). */
export type ScheduleDayDto = {
  orders: ProductionOrderSummaryDto[]
  /** Planned output per unit, summed in Decimal — e.g. [{ quantity: "40", unit: "kg" }]. */
  totals: { quantity: string; unit: string }[]
}

export type ScheduleDto = {
  /** Keyed by YYYY-MM-DD; days without orders are absent. */
  days: Record<string, ScheduleDayDto>
  /** True when the range held more than SCHEDULE_LIMIT orders and the rest are not shown. */
  truncated: boolean
}

export type ProductionOrderResult<T> =
  | { success: true;  data: T }
  | { success: false; error: string; status: number }

type Viewer = { userId: string; role: string }

/** The most orders one calendar screen loads (Task 7, D7). */
export const SCHEDULE_LIMIT = 500

/** What the calendar shows by default: everything that will be, or was, cooked (D3). */
const SCHEDULED_STATUSES: ProductionStatus[] = [
  ProductionStatus.DRAFT,
  ProductionStatus.PENDING_APPROVAL,
  ProductionStatus.APPROVED,
  ProductionStatus.IN_PROGRESS,
  ProductionStatus.PENDING_COMPLETION,
  ProductionStatus.COMPLETED,
]

/** Every status, in workflow order — the list page's filter options. */
export const PRODUCTION_STATUSES = Object.values(ProductionStatus)

/** Narrows a query-string value, e.g. the list page's ?status=, to the enum. */
export function isProductionStatus(value: string): value is ProductionStatus {
  return PRODUCTION_STATUSES.some(status => status === value)
}

function toSummaryDto(order: ProductionOrderWithDetail): ProductionOrderSummaryDto {
  return {
    id:               order.id,
    orderNumber:      order.orderNumber,
    status:           order.status,
    finishedGoodId:   order.finishedGood.id,
    finishedGoodCode: order.finishedGood.code,
    finishedGoodName: order.finishedGood.name,
    bomId:            order.bom.id,
    bomVersion:       order.bom.version,
    bomIsActive:      order.bom.isActive,
    unitAbbreviation: order.bom.batchUnit.abbreviation,
    batchWeight:      toDecimalString(order.batchWeight),
    batchCount:       order.batchCount,
    plannedQty:       toDecimalString(order.plannedQty),
    plannedDate:      order.plannedDate.toISOString().slice(0, 10),
    branchId:         order.branch.id,
    branchName:       order.branch.name,
    requestedById:    order.requestedBy.id,
    requestedByName:  order.requestedBy.name,
    submittedById:    order.submittedBy?.id ?? null,
    submittedByName:  order.submittedBy?.name ?? null,
    createdAt:        order.createdAt.toISOString(),
  }
}

/**
 * Statuses whose ingredients have not left the books yet, so today's stock
 * means something for them (Task 3, D5) — including a run reported done but
 * not yet signed off, whose deduction is still to come (Week 6 Task 1). Once
 * completed, rejected or cancelled, the check is hidden.
 */
const STOCK_CHECK_STATUSES: ProductionStatus[] = [
  ProductionStatus.DRAFT,
  ProductionStatus.PENDING_APPROVAL,
  ProductionStatus.APPROVED,
  ProductionStatus.IN_PROGRESS,
  ProductionStatus.PENDING_COMPLETION,
]

/**
 * Where a run can still be called off (Week 5 Task 6, D5). Not once it is in
 * progress: ingredients are partly used, so stopping it needs a write-off
 * (Week 7), not a cancel.
 */
export const CANCELLABLE_STATUSES: ProductionStatus[] = [
  ProductionStatus.DRAFT,
  ProductionStatus.PENDING_APPROVAL,
  ProductionStatus.APPROVED,
]

/**
 * Statuses where ordering the shortfall still helps (Task 4, D4). A run in
 * progress is cooking with what it has.
 */
export const SHORTFALL_REQUEST_STATUSES: ProductionStatus[] = [
  ProductionStatus.DRAFT,
  ProductionStatus.PENDING_APPROVAL,
  ProductionStatus.APPROVED,
]

type ScaledLine = {
  item: BomWithDetail['items'][number]
  perBatch: Prisma.Decimal
  total: Prisma.Decimal
}

/**
 * What a run needs, line by line, in Decimal. Both figures are scaled
 * straight from the BOM — per batch to batchWeight, total to plannedQty —
 * rather than total = per batch × batchCount, so the total never carries a
 * rounded intermediate. The units are the materials' own: BomService refuses
 * a line in any other.
 *
 * The one place an order is scaled: this order's requirements and what other
 * orders have committed both come from here, so they cannot disagree.
 */
function scaleOrder(bom: BomWithDetail, batchWeight: Prisma.Decimal, plannedQty: Prisma.Decimal): ScaledLine[] {
  const perBatch = new Map(scaleBomQuantities(bom, batchWeight).map(line => [line.lineId, line.quantity]))
  const total    = new Map(scaleBomQuantities(bom, plannedQty).map(line => [line.lineId, line.quantity]))

  return bom.items.map(item => ({
    item,
    perBatch: perBatch.get(item.id) ?? item.quantity,
    total:    total.get(item.id) ?? item.quantity,
  }))
}

/**
 * What a completed run takes out of stock: the pinned BOM at the planned
 * quantity, one entry per material (merged if a BOM lists one twice), in BOM
 * order (Week 6 Task 2, D2). The approval transaction writes exactly this, and
 * the approver's preview shows exactly this, so the two cannot disagree.
 */
function consumptionByMaterial(
  bom: BomWithDetail,
  batchWeight: Prisma.Decimal,
  plannedQty: Prisma.Decimal,
): Map<string, { item: BomWithDetail['items'][number]; quantity: Prisma.Decimal }> {
  const byMaterial = new Map<string, { item: BomWithDetail['items'][number]; quantity: Prisma.Decimal }>()
  for (const line of scaleOrder(bom, batchWeight, plannedQty)) {
    const current = byMaterial.get(line.item.materialId)
    byMaterial.set(line.item.materialId, { item: line.item, quantity: (current?.quantity ?? new Prisma.Decimal(0)).add(line.total) })
  }
  return byMaterial
}

/**
 * A run's ingredients priced on one date (Week 6 Task 3, D1–D3): the BOM at
 * the quantities a completion deducts (consumptionByMaterial), each at the
 * reference price in force that day — one query for all lines, the same
 * lookup purchase requests and the BOM viewer use. `spreadOver` is the
 * quantity the total is divided by for the per-unit figure.
 *
 * Returns Decimals as well as the DTO so approval can store exactly what the
 * card shows.
 */
async function costRun(
  bom: BomWithDetail,
  order: { batchWeight: Prisma.Decimal; plannedQty: Prisma.Decimal },
  pricedOn: string,
  spreadOver: Prisma.Decimal,
): Promise<{ dto: RunCostDto; total: Prisma.Decimal | null; prices: Map<string, Prisma.Decimal> }> {
  const consumption = consumptionByMaterial(bom, order.batchWeight, order.plannedQty)
  // Date-only prices are stored at UTC midnight, so the end of that UTC day
  // takes in every price effective "on" the date, not only before it.
  const prices = await ItemPriceRepository.findPricesAsOf([...consumption.keys()], new Date(`${pricedOn}T23:59:59.999Z`), null)

  let total: Prisma.Decimal | null = new Prisma.Decimal(0)
  const missing: string[] = []
  const lines = [...consumption.values()].map<CostLineDto>(({ item, quantity }) => {
    const price = prices.get(item.materialId)
    const cost  = price ? quantity.mul(price.unitPrice) : null
    if (cost === null) missing.push(item.material.name)
    total = total !== null && cost !== null ? total.add(cost) : null
    return {
      materialId:       item.materialId,
      materialCode:     item.material.code,
      materialName:     item.material.name,
      unitAbbreviation: item.unit.abbreviation,
      quantity:         toDecimalString(quantity),
      unitPrice:        price ? toDecimalString(price.unitPrice) : null,
      priceEffective:   price ? price.effectiveDate.toISOString().slice(0, 10) : null,
      cost:             cost === null ? null : toDecimalString(cost),
    }
  })

  const finalTotal: Prisma.Decimal | null = total
  return {
    dto: {
      pricedOn,
      lines,
      total:   finalTotal === null ? null : toDecimalString(finalTotal),
      perUnit: finalTotal === null ? null : toDecimalString(finalTotal.div(spreadOver)),
      missing,
    },
    total: finalTotal,
    prices: new Map([...prices].map(([materialId, price]) => [materialId, price.unitPrice])),
  }
}

/**
 * The variance (D3): what the output cost beyond what that much output should
 * have cost at the planned cost per unit. Positive = over plan.
 */
function costVariance(
  plannedCost: Prisma.Decimal,
  plannedQty: Prisma.Decimal,
  actualCost: Prisma.Decimal,
  actualQty: Prisma.Decimal,
): Prisma.Decimal {
  return actualCost.sub(plannedCost.div(plannedQty).mul(actualQty))
}

/**
 * The Costing card for an order (D7), by status: an estimate while the run is
 * still to happen, the figures approving would record while a completion
 * waits, and the stored figures once completed. None for a run that will
 * never happen (rejected, cancelled).
 */
async function costingFor(
  bom: BomWithDetail,
  order: ProductionOrderWithDetail,
  stockMoved: CompletionStockDto | null,
): Promise<CostingDto | null> {
  const unitAbbreviation = order.bom.batchUnit.abbreviation
  const plannedOn        = order.plannedDate.toISOString().slice(0, 10)

  if (order.status === ProductionStatus.REJECTED || order.status === ProductionStatus.CANCELLED) return null
  if (order.status === ProductionStatus.COMPLETED) return recordedCosting(order, stockMoved)

  const planned = await costRun(bom, order, plannedOn, order.plannedQty)

  if (order.status === ProductionStatus.PENDING_COMPLETION && order.actualQty !== null && order.completedAt !== null) {
    const actual = await costRun(bom, order, isoDateAt(order.completedAt), order.actualQty)
    return {
      kind: 'PENDING',
      unitAbbreviation,
      plannedQty: toDecimalString(order.plannedQty),
      planned: planned.dto,
      actual:  { ...actual.dto, yield: toDecimalString(order.actualQty) },
      variance: planned.total !== null && actual.total !== null
        ? toDecimalString(costVariance(planned.total, order.plannedQty, actual.total, order.actualQty))
        : null,
    }
  }

  return {
    kind: 'ESTIMATE', unitAbbreviation, plannedQty: toDecimalString(order.plannedQty),
    planned: planned.dto, actual: null, variance: null,
  }
}

/**
 * A completed run's Costing card, from what approval stored (D4) — the cost
 * columns and the prices on the ledger rows — never recomputed, because
 * prices may have been back-dated since. The planned figure has no stored
 * breakdown; the batch cost's lines are the ledger's. Null for a run approved
 * before costing existed.
 */
function recordedCosting(order: ProductionOrderWithDetail, stockMoved: CompletionStockDto | null): CostingDto | null {
  const { plannedCost, actualCost, costPerUnit, costVariance: variance, actualQty } = order
  if (plannedCost === null || actualCost === null || costPerUnit === null || variance === null || actualQty === null) return null

  const lines = (stockMoved?.ingredients ?? []).map<CostLineDto>(movement => {
    const quantity = toDecimal(movement.quantity).abs()
    return {
      materialId:       movement.materialId,
      materialCode:     movement.materialCode,
      materialName:     movement.materialName,
      unitAbbreviation: movement.unitAbbreviation,
      quantity:         toDecimalString(quantity),
      unitPrice:        movement.unitCost,
      // Not kept on the ledger; the price itself is what was recorded.
      priceEffective:   null,
      cost:             movement.unitCost === null ? null : toDecimalString(quantity.mul(toDecimal(movement.unitCost))),
    }
  })

  return {
    kind:             'RECORDED',
    unitAbbreviation: order.bom.batchUnit.abbreviation,
    plannedQty:       toDecimalString(order.plannedQty),
    planned: {
      pricedOn: order.plannedDate.toISOString().slice(0, 10),
      lines:    [],
      total:    toDecimalString(plannedCost),
      perUnit:  toDecimalString(plannedCost.div(order.plannedQty)),
      missing:  [],
    },
    actual: {
      pricedOn: stockMoved?.lot?.producedOn ?? (order.completedAt ? isoDateAt(order.completedAt) : '—'),
      lines,
      total:    toDecimalString(actualCost),
      perUnit:  toDecimalString(costPerUnit),
      missing:  [],
      yield:    toDecimalString(actualQty),
    },
    variance: toDecimalString(variance),
  }
}

/**
 * When a run's lot must no longer be used (Week 6 Task 4, D2): the moment the
 * kitchen reported it done plus the finished good's shelf life — food ages
 * from cooking, not from accounting's approval. Null without a shelf life.
 */
function lotExpiry(completedAt: Date, shelfLifeHours: number | null): Date | null {
  return shelfLifeHours === null ? null : new Date(completedAt.getTime() + shelfLifeHours * 60 * 60 * 1000)
}

/**
 * The approver's preview (D8): each ingredient against what is on hand at the
 * branch now, and the lot that would come in. On hand only, not committed —
 * this is what the books will read straight after approval.
 */
async function completionEffect(
  bom: BomWithDetail,
  order: ProductionOrderWithDetail,
  actualQty: Prisma.Decimal,
): Promise<CompletionEffectDto> {
  const consumption = consumptionByMaterial(bom, order.batchWeight, order.plannedQty)
  const onHand      = await InventoryRepository.levelsAtBranch(order.branch.id, [...consumption.keys()])
  const zero        = new Prisma.Decimal(0)

  const ingredients = [...consumption.values()].map(({ item, quantity }) => {
    const lineOnHand = onHand.get(item.materialId) ?? zero
    const after      = lineOnHand.sub(quantity)
    return {
      materialId:       item.materialId,
      materialCode:     item.material.code,
      materialName:     item.material.name,
      unitAbbreviation: item.unit.abbreviation,
      deduct:           toDecimalString(quantity),
      onHand:           toDecimalString(lineOnHand),
      after:            toDecimalString(after),
      goesNegative:     after.lessThan(0),
    }
  })

  return {
    ingredients,
    negativeCount: ingredients.filter(line => line.goesNegative).length,
    lot: {
      lotNumber:        order.orderNumber,
      quantity:         toDecimalString(actualQty),
      unitAbbreviation: order.bom.batchUnit.abbreviation,
      branchName:       order.branch.name,
      expiresAt:        order.completedAt === null ? null : lotExpiry(order.completedAt, order.finishedGood.shelfLifeHours)?.toISOString() ?? null,
      shelfLifeHours:   order.finishedGood.shelfLifeHours,
    },
  }
}

/** Both ledgers' rows for an approved completion (D8). */
async function completionStock(orderId: string): Promise<CompletionStockDto> {
  const [materials, finished] = await Promise.all([
    InventoryRepository.findMovementsByReference('ProductionOrder', orderId),
    FinishedGoodStockRepository.findMovementsByReference('ProductionOrder', orderId),
  ])
  const lotIn = finished.find(movement => movement.quantity.greaterThan(0))

  return {
    ingredients: materials.map(movement => ({
      id:               movement.id,
      materialId:       movement.materialId,
      branchId:         movement.branchId,
      materialCode:     movement.material.code,
      materialName:     movement.material.name,
      unitAbbreviation: movement.material.unit.abbreviation,
      quantity:         toDecimalString(movement.quantity),
      unitCost:         movement.unitCost === null ? null : toDecimalString(movement.unitCost),
    })),
    lot: lotIn ? {
      lotNumber:        lotIn.lot.lotNumber,
      quantity:         toDecimalString(lotIn.quantity),
      unitAbbreviation: lotIn.lot.finishedGood.unit.abbreviation,
      producedOn:       lotIn.lot.producedOn.toISOString().slice(0, 10),
      branchName:       lotIn.branch.name,
      unitCost:         lotIn.unitCost === null ? null : toDecimalString(lotIn.unitCost),
      expiresAt:        lotIn.lot.expiresAt?.toISOString() ?? null,
    } : null,
  }
}

/**
 * Required vs available per line, at one branch, right now (Task 3).
 * Available is on hand minus what approved / in-progress orders there still
 * need: stock only leaves the shelf when a run completes (Week 6), so without
 * this two approved orders would both count the same kilo. Expected
 * deliveries are not counted.
 */
async function stockFor(
  lines: ScaledLine[],
  branchId: string,
  excludeOrderId: string | null,
): Promise<Map<string, LineStockDto>> {
  const zero = new Prisma.Decimal(0)
  const [onHand, committedOrders] = await Promise.all([
    InventoryRepository.levelsAtBranch(branchId, lines.map(line => line.item.materialId)),
    ProductionOrderRepository.findCommittedAtBranch(branchId, excludeOrderId),
  ])

  const committed = new Map<string, Prisma.Decimal>()
  for (const order of committedOrders) {
    for (const line of scaleOrder(order.bom, order.batchWeight, order.plannedQty)) {
      const materialId = line.item.materialId
      committed.set(materialId, (committed.get(materialId) ?? zero).add(line.total))
    }
  }

  return new Map(lines.map(line => {
    const materialId    = line.item.materialId
    const lineOnHand    = onHand.get(materialId) ?? zero
    const lineCommitted = committed.get(materialId) ?? zero
    const available     = lineOnHand.sub(lineCommitted)
    // Never short by more than this run needs. When other orders have already
    // committed more than is on hand (available < 0), this run is short its
    // whole requirement — counting the overdraft too would put the other
    // orders' deficit on this one, and two approved runs would each report
    // the other's need, double-ordering it (found in Week 5 Task 5 testing).
    const short         = Prisma.Decimal.max(line.total.sub(Prisma.Decimal.max(available, zero)), zero)
    return [materialId, {
      onHand:    toDecimalString(lineOnHand),
      committed: toDecimalString(lineCommitted),
      available: toDecimalString(available),
      short:     toDecimalString(short),
      enough:    line.total.lessThanOrEqualTo(available),
    }]
  }))
}

/**
 * An order's requirement lines, with the stock check when `stockAt` is given.
 * Behind both the order page and the form's preview.
 */
async function materialRequirements(
  bom: BomWithDetail,
  batchWeight: Prisma.Decimal,
  plannedQty: Prisma.Decimal,
  stockAt: { branchId: string; excludeOrderId: string | null } | null,
): Promise<MaterialRequirementDto[]> {
  const lines = scaleOrder(bom, batchWeight, plannedQty)
  const stock = stockAt ? await stockFor(lines, stockAt.branchId, stockAt.excludeOrderId) : null

  return lines.map(line => ({
    materialId:       line.item.materialId,
    materialCode:     line.item.material.code,
    materialName:     line.item.material.name,
    unitAbbreviation: line.item.unit.abbreviation,
    perBatch:         toDecimalString(line.perBatch),
    total:            toDecimalString(line.total),
    stock:            stock?.get(line.item.materialId) ?? null,
  }))
}

/**
 * The same roles middleware allows on /api/production-orders. Repeated here so
 * the rule holds wherever the service is called from — Week 9's AI write
 * action will call create() without going through the route.
 */
function canPlan(role: string) {
  return role === 'ADMIN' || role === 'PRODUCTION_MANAGER'
}

/**
 * Queues a notification job after the change it reports has committed. A
 * queue failure never fails the user's action (docs/architecture.md): the
 * order is already saved and visible, so a missing notification is a degraded
 * nicety, not a reason to undo their work.
 */
async function enqueue(jobName: string, productionOrderId: string): Promise<void> {
  try {
    await getNotificationQueue().add(jobName, { productionOrderId } satisfies ProductionOrderJob)
  } catch (err) {
    console.error(`[ProductionOrderService] could not enqueue ${jobName}`, err)
  }
}

/**
 * Checks an order's fields against the database and returns what gets stored.
 * Shared by create and update, so a draft can never be saved under
 * looser rules than a new order.
 *
 * The BOM is whichever version is active right now: a draft re-pins on every
 * save (D9), and the pin only becomes permanent when the order is submitted.
 */
async function validateOrder(input: CreateProductionOrderServiceInput): Promise<ProductionOrderResult<{
  bomId: string
  branchId: string
  batchWeight: Prisma.Decimal
  plannedQty: Prisma.Decimal
  plannedDate: Date
}>> {
  const [good, bom, branch] = await Promise.all([
    FinishedGoodRepository.findById(input.finishedGoodId),
    BomRepository.findActiveByFinishedGood(input.finishedGoodId),
    BranchRepository.findById(input.branchId),
  ])

  if (!good || !good.isActive) {
    return { success: false, error: 'Finished good not found', status: 400 }
  }
  if (!bom) {
    return { success: false, error: `${good.name} has no active BOM — create one before planning production`, status: 400 }
  }
  // plannedQty is batchWeight × batchCount in the BOM's batch unit, and Week 6
  // adds it to stock in the finished good's unit. Until there is a conversion
  // layer the two must be the same unit, or the stock figure is silently wrong.
  if (bom.batchUnitId !== good.unitId) {
    return {
      success: false,
      error:   `${good.name}'s BOM is stated per ${bom.batchUnit.abbreviation} but it is stocked in ${good.unit.abbreviation} — unit conversion is not supported yet`,
      status:  400,
    }
  }

  if (!branch || !branch.isActive) {
    return { success: false, error: 'Branch not found', status: 400 }
  }

  const batchWeight = toDecimal(input.batchWeight)
  if (batchWeight.lessThanOrEqualTo(0)) {
    return { success: false, error: 'Batch weight must be greater than zero', status: 400 }
  }
  if (!Number.isInteger(input.batchCount) || input.batchCount < 1 || input.batchCount > MAX_BATCH_COUNT) {
    return { success: false, error: `Number of batches must be a whole number from 1 to ${MAX_BATCH_COUNT}`, status: 400 }
  }

  // Plain string comparison works because both sides are YYYY-MM-DD.
  if (input.plannedDate < todayIsoDate()) {
    return { success: false, error: 'The production date cannot be in the past', status: 400 }
  }

  return {
    success: true,
    data: {
      bomId:       bom.id,
      branchId:    branch.id,
      batchWeight,
      plannedQty:  batchWeight.mul(input.batchCount),
      // Midnight UTC of the chosen date, like a receiving report's receivedAt,
      // so .slice(0, 10) on the ISO string reads it back unchanged.
      plannedDate: new Date(input.plannedDate),
    },
  }
}

export const ProductionOrderService = {
  /**
   * No viewer scoping, like receiving reports: production is planned for the
   * organisation, and every role allowed on /production/orders needs the
   * whole list.
   */
  async list(filters: ProductionOrderListFilters = {}) {
    const { rows, total } = await ProductionOrderRepository.findMany(filters)
    return { productionOrders: rows.map(toSummaryDto), total }
  },

  async getById(id: string): Promise<ProductionOrderResult<ProductionOrderDetailDto>> {
    const order = await ProductionOrderRepository.findById(id)
    if (!order) {
      return { success: false, error: 'Production order not found', status: 404 }
    }

    // The pinned version with its lines, for the requirements. Only a
    // superseded pin also needs the active version.
    // Decisions are read from the status log (with their remarks), not the
    // Approval rows: the timeline shows them in sequence with everything else.
    // A completed order's stock moves are read back once, for its Stock moved
    // card and its recorded costing.
    const [pinned, active, statusChanges, stockMoved] = await Promise.all([
      BomRepository.findById(order.bomId),
      order.bom.isActive ? null : BomRepository.findActiveByFinishedGood(order.finishedGood.id),
      ProductionOrderRepository.findStatusChanges(order.id),
      order.status === ProductionStatus.COMPLETED ? completionStock(order.id) : null,
    ])
    // bomId is a foreign key and BOM rows are never deleted, so this cannot
    // happen short of a hand-edited database.
    if (!pinned) {
      return { success: false, error: 'The BOM this order is pinned to no longer exists', status: 404 }
    }

    return {
      success: true,
      data: {
        ...toSummaryDto(order),
        notes:            order.notes,
        updatedAt:        order.updatedAt.toISOString(),
        activeBomVersion: active?.version ?? null,
        requirements:     await materialRequirements(
          pinned, order.batchWeight, order.plannedQty,
          STOCK_CHECK_STATUSES.includes(order.status) ? { branchId: order.branch.id, excludeOrderId: order.id } : null,
        ),
        statusChanges: statusChanges.map(change => ({
          id:            change.id,
          fromStatus:    change.fromStatus,
          toStatus:      change.toStatus,
          changedByName: change.changedBy.name,
          note:          change.note,
          at:            change.createdAt.toISOString(),
        })),
        // Computed in Decimal here so the page only formats: plannedQty is
        // never zero (batch weight > 0, at least one batch).
        actualYield: order.actualQty === null ? null : {
          actualQty:     toDecimalString(order.actualQty),
          difference:    toDecimalString(order.actualQty.sub(order.plannedQty)),
          percentOfPlan: toDecimalString(order.actualQty.div(order.plannedQty).mul(100).toDecimalPlaces(1)),
        },
        completedByName: order.completedBy?.name ?? null,
        completedAt:     order.completedAt?.toISOString() ?? null,
        completedById:   order.completedBy?.id ?? null,
        completionEffect: order.status === ProductionStatus.PENDING_COMPLETION && order.actualQty !== null
          ? await completionEffect(pinned, order, order.actualQty)
          : null,
        stockMoved,
        costing:    await costingFor(pinned, order, stockMoved),
      },
    }
  },

  /**
   * The purchase request pre-fill for an order's shortfall: one line per short
   * material at the short quantity. Null — so the page shows the ordinary
   * empty form — when the order is unknown, past the point of ordering, or
   * short of nothing. Nothing is created here; the requester reviews and saves.
   */
  async shortfallRequest(id: string): Promise<ShortfallRequestDto | null> {
    const result = await ProductionOrderService.getById(id)
    if (!result.success) return null
    const order = result.data
    if (!SHORTFALL_REQUEST_STATUSES.includes(order.status)) return null

    const lines = order.requirements.flatMap(line =>
      line.stock && !line.stock.enough
        // toFixed(), not toString(): Decimal writes very small values as
        // 1e-7, which the purchase request's quantity pattern rejects.
        ? [{ materialId: line.materialId, quantity: toDecimal(line.stock.short).toFixed() }]
        : [],
    )
    if (lines.length === 0) return null

    return {
      productionOrderId: order.id,
      orderNumber:       order.orderNumber,
      neededBy:          order.plannedDate,
      notes:             `Shortfall for ${order.orderNumber} — ${order.finishedGoodName} ${trimDecimal(order.plannedQty)} ${order.unitAbbreviation} on ${order.plannedDate} at ${order.branchName}`,
      lines,
    }
  },

  /**
   * The form's live preview: the active BOM scaled to a batch weight and count
   * that have not been saved yet, with the stock check at the chosen branch.
   * Read-only, so it checks only what the calculation needs; the date and the
   * unit rule are left to save, where the form already shows them.
   *
   * No order is excluded from committed: only a draft can be edited, and a
   * draft commits nothing.
   */
  async previewRequirements(input: {
    finishedGoodId: string
    batchWeight: string
    batchCount: number
    branchId: string
  }): Promise<ProductionOrderResult<RequirementsPreviewDto>> {
    const [bom, branch] = await Promise.all([
      BomRepository.findActiveByFinishedGood(input.finishedGoodId),
      BranchRepository.findById(input.branchId),
    ])
    if (!bom) {
      return { success: false, error: 'This finished good has no active BOM', status: 404 }
    }
    if (!branch || !branch.isActive) {
      return { success: false, error: 'Branch not found', status: 400 }
    }

    const batchWeight = toDecimal(input.batchWeight)
    if (batchWeight.lessThanOrEqualTo(0)) {
      return { success: false, error: 'Batch weight must be greater than zero', status: 400 }
    }
    const plannedQty = batchWeight.mul(input.batchCount)

    return {
      success: true,
      data: {
        bomId:       bom.id,
        bomVersion:  bom.version,
        batchWeight: toDecimalString(batchWeight),
        batchCount:  input.batchCount,
        plannedQty:  toDecimalString(plannedQty),
        branchName:  branch.name,
        lines:       await materialRequirements(bom, batchWeight, plannedQty, { branchId: branch.id, excludeOrderId: null }),
      },
    }
  },

  /** What the new / edit form offers: plannable goods and active branches. */
  async getForm(): Promise<ProductionOrderFormDto> {
    const [boms, branches] = await Promise.all([
      BomRepository.findAllActiveForPlanning(),
      BranchRepository.findAllActive(),
    ])

    return {
      goods: boms.map<PlannableGoodDto>(bom => ({
        finishedGoodId:   bom.finishedGood.id,
        code:             bom.finishedGood.code,
        name:             bom.finishedGood.name,
        bomId:            bom.id,
        bomVersion:       bom.version,
        batchSize:        toDecimalString(bom.batchSize),
        unitAbbreviation: bom.batchUnit.abbreviation,
        unitsMatch:       bom.batchUnitId === bom.finishedGood.unitId,
      })),
      branches,
    }
  },

  /**
   * Saves a new order as a DRAFT. Nothing is reserved or deducted: stock moves
   * only when a run is completed (Week 6). The requester is the caller, never
   * a body field.
   */
  async create(
    input: CreateProductionOrderServiceInput,
    viewer: Viewer,
  ): Promise<ProductionOrderResult<{ id: string; orderNumber: string }>> {
    if (!canPlan(viewer.role)) {
      return { success: false, error: 'Only production can plan a production order', status: 403 }
    }

    const checked = await validateOrder(input)
    if (!checked.success) return checked

    const created = await ProductionOrderRepository.create({
      finishedGoodId: input.finishedGoodId,
      bomId:          checked.data.bomId,
      branchId:       checked.data.branchId,
      requestedById:  viewer.userId,
      batchWeight:    checked.data.batchWeight,
      batchCount:     input.batchCount,
      plannedQty:     checked.data.plannedQty,
      plannedDate:    checked.data.plannedDate,
      notes:          input.notes ?? null,
    })

    return { success: true, data: created }
  },

  /**
   * Rewrites a DRAFT order under the same rules as create. Any ADMIN or
   * PRODUCTION_MANAGER may edit it (D5) and requestedById stays the creator:
   * Task 5's self-approval check compares the approver with whoever submits.
   *
   * bomId is re-pinned to the active version on every save (D9), whether or
   * not the finished good changed.
   */
  async update(
    id: string,
    input: UpdateProductionOrderServiceInput,
    viewer: Viewer,
  ): Promise<ProductionOrderResult<{ id: string; orderNumber: string }>> {
    if (!canPlan(viewer.role)) {
      return { success: false, error: 'Only production can edit a production order', status: 403 }
    }

    const order = await ProductionOrderRepository.findById(id)
    if (!order) {
      return { success: false, error: 'Production order not found', status: 404 }
    }
    // An early, friendlier answer; updateDraft's WHERE is what actually holds.
    if (order.status !== ProductionStatus.DRAFT) {
      return {
        success: false,
        error:   `This order is ${order.status.replace(/_/g, ' ').toLowerCase()} and can no longer be edited`,
        status:  409,
      }
    }

    const checked = await validateOrder(input)
    if (!checked.success) return checked

    const updated = await ProductionOrderRepository.updateDraft(id, {
      finishedGoodId: input.finishedGoodId,
      bomId:          checked.data.bomId,
      branchId:       checked.data.branchId,
      batchWeight:    checked.data.batchWeight,
      batchCount:     input.batchCount,
      plannedQty:     checked.data.plannedQty,
      plannedDate:    checked.data.plannedDate,
      notes:          input.notes ?? null,
    })
    if (!updated) {
      return { success: false, error: 'This order changed while you were editing it — reload and try again', status: 409 }
    }

    return { success: true, data: { id: order.id, orderNumber: order.orderNumber } }
  },

  /**
   * The schedule calendar: orders planned between two dates, grouped by day,
   * with each day's planned output summed per unit in Decimal (Task 7, D5).
   * Rejected and cancelled orders only when asked for (D3).
   */
  async schedule(input: {
    from: string
    to: string
    branchId?: string
    includeClosed: boolean
  }): Promise<ScheduleDto> {
    const rows = await ProductionOrderRepository.findPlannedBetween({
      from:     new Date(input.from),
      to:       new Date(input.to),
      statuses: input.includeClosed ? PRODUCTION_STATUSES : SCHEDULED_STATUSES,
      branchId: input.branchId,
      take:     SCHEDULE_LIMIT + 1,
    })
    const truncated = rows.length > SCHEDULE_LIMIT

    const days: Record<string, ScheduleDayDto> = {}
    const sums = new Map<string, Map<string, Prisma.Decimal>>()
    for (const order of rows.slice(0, SCHEDULE_LIMIT)) {
      const day  = order.plannedDate.toISOString().slice(0, 10)
      const unit = order.bom.batchUnit.abbreviation
      const entry = days[day] ?? { orders: [], totals: [] }
      entry.orders.push(toSummaryDto(order))
      days[day] = entry
      // A rejected or cancelled order will not be cooked, so it is listed
      // (when shown) but not counted in the day's load.
      if (order.status === ProductionStatus.REJECTED || order.status === ProductionStatus.CANCELLED) continue
      const perUnit = sums.get(day) ?? new Map<string, Prisma.Decimal>()
      perUnit.set(unit, (perUnit.get(unit) ?? new Prisma.Decimal(0)).add(order.plannedQty))
      sums.set(day, perUnit)
    }
    for (const [day, perUnit] of sums) {
      days[day].totals = [...perUnit].map(([unit, quantity]) => ({ quantity: toDecimalString(quantity), unit }))
    }

    return { days, truncated }
  },

  /**
   * The approvals inbox: every order awaiting a decision, with how many of its
   * ingredients are short at its branch right now (Task 4 deferred the count
   * to here). Two stock queries per order, bounded by `take`.
   */
  async listPending(take = 100): Promise<PendingProductionOrderDto[]> {
    const orders = await ProductionOrderRepository.findPendingWithBom(ProductionStatus.PENDING_APPROVAL, take)

    return Promise.all(orders.map(async order => {
      const lines = await materialRequirements(
        order.bom, order.batchWeight, order.plannedQty,
        { branchId: order.branch.id, excludeOrderId: order.id },
      )
      return {
        ...toSummaryDto(order),
        ingredientCount: lines.length,
        shortCount:      lines.filter(line => line.stock !== null && !line.stock.enough).length,
      }
    }))
  },

  /**
   * The approvals inbox's reported completions (Week 6 Task 2, D9): each with
   * its yield against plan, how many ingredients approval would take below
   * zero and the cost per unit it would record — the same figures as the
   * order page's preview. One stock and one price query per order, bounded by
   * `take`.
   */
  async listPendingCompletions(take = 100): Promise<PendingCompletionDto[]> {
    const orders = await ProductionOrderRepository.findPendingWithBom(ProductionStatus.PENDING_COMPLETION, take)

    return Promise.all(orders.flatMap(order => {
      if (order.actualQty === null || order.completedAt === null) return []
      const actualQty  = order.actualQty
      const producedOn = isoDateAt(order.completedAt)
      return [Promise.all([
        completionEffect(order.bom, order, actualQty),
        // The cost per unit approving would record (Week 6 Task 3).
        costRun(order.bom, order, producedOn, actualQty),
      ]).then(([effect, cost]) => ({
        ...toSummaryDto(order),
        actualQty:       toDecimalString(actualQty),
        percentOfPlan:   toDecimalString(actualQty.div(order.plannedQty).mul(100).toDecimalPlaces(1)),
        completedByName: order.completedBy?.name ?? null,
        ingredientCount: effect.ingredients.length,
        negativeCount:   effect.negativeCount,
        costPerUnit:     cost.dto.perUnit,
      }))]
    }))
  },

  /**
   * DRAFT → PENDING_APPROVAL (Task 5, D1). The saved order goes through
   * validateOrder again — a draft saved last week may now have a past date or
   * an inactive branch — and a superseded BOM pin is refused rather than
   * switched (D2): what accounting approves must be what the planner last
   * saw, so they open Edit, look, and save first. Shortages do not block (D3).
   */
  async submit(id: string, viewer: Viewer): Promise<ProductionOrderResult<{ id: string; orderNumber: string }>> {
    if (!canPlan(viewer.role)) {
      return { success: false, error: 'Only production can submit a production order', status: 403 }
    }

    const order = await ProductionOrderRepository.findById(id)
    if (!order) {
      return { success: false, error: 'Production order not found', status: 404 }
    }
    if (order.status !== ProductionStatus.DRAFT) {
      return {
        success: false,
        error:   `This order is already ${order.status.replace(/_/g, ' ').toLowerCase()} and cannot be submitted again`,
        status:  409,
      }
    }

    const checked = await validateOrder({
      finishedGoodId: order.finishedGood.id,
      batchWeight:    order.batchWeight.toString(),
      batchCount:     order.batchCount,
      plannedDate:    order.plannedDate.toISOString().slice(0, 10),
      branchId:       order.branch.id,
    })
    if (!checked.success) {
      return { ...checked, error: `${checked.error}. Edit the draft and save it, then submit.` }
    }
    if (checked.data.bomId !== order.bom.id) {
      return {
        success: false,
        error:   `BOM v${order.bom.version} has been replaced by a newer version. Open Edit and save to switch to it, then submit.`,
        status:  409,
      }
    }

    const submitted = await ProductionOrderRepository.submit(id, { submittedById: viewer.userId, bomId: order.bom.id })
    if (!submitted) {
      return { success: false, error: 'This order changed while you were submitting it — reload and try again', status: 409 }
    }

    await enqueue(PRODUCTION_ORDER_SUBMITTED, id)
    return { success: true, data: { id: order.id, orderNumber: order.orderNumber } }
  },

  /**
   * PENDING_APPROVAL → APPROVED | REJECTED. Called from POST /api/approvals,
   * which middleware restricts to ACCOUNTING and ADMIN (D4).
   *
   * Whoever submitted it cannot decide it, ADMIN included. submittedById is
   * set once, at submit, and never changes while pending, so this read cannot
   * go stale; the status can, which is why decide() re-checks it in its WHERE.
   */
  async applyDecision(
    id: string,
    viewer: Viewer,
    decision: 'APPROVED' | 'REJECTED',
    remarks: string | null,
  ): Promise<ProductionOrderResult<{ id: string; orderNumber: string }>> {
    const order = await ProductionOrderRepository.findById(id)
    if (!order) {
      return { success: false, error: 'Production order not found', status: 404 }
    }

    if (order.submittedBy?.id === viewer.userId) {
      return {
        success: false,
        error:   'You submitted this order, so someone else has to decide it',
        status:  403,
      }
    }

    if (order.status !== ProductionStatus.PENDING_APPROVAL) {
      return {
        success: false,
        error:   `This order is ${order.status.replace(/_/g, ' ').toLowerCase()} and is no longer awaiting a decision`,
        status:  409,
      }
    }

    if (decision === 'REJECTED' && (remarks === null || remarks.trim() === '')) {
      return { success: false, error: 'Give a reason when rejecting', status: 400 }
    }

    const decided = await ProductionOrderRepository.decide({ id, approverId: viewer.userId, decision, remarks })
    if (!decided) {
      return { success: false, error: 'This order was decided by someone else just now', status: 409 }
    }

    await enqueue(PRODUCTION_ORDER_DECIDED, id)
    return { success: true, data: { id: order.id, orderNumber: order.orderNumber } }
  },

  /**
   * APPROVED → IN_PROGRESS: the kitchen has begun (Week 5 Task 6, D3).
   * Shortages do not block — stock records can lag behind deliveries, and the
   * kitchen sees the shelf — and there is no date rule (D4); the timeline
   * shows a start before the production date. Nothing moves in stock: that
   * happens on completion (Week 6).
   */
  async start(id: string, viewer: Viewer): Promise<ProductionOrderResult<{ id: string; orderNumber: string }>> {
    if (!canPlan(viewer.role)) {
      return { success: false, error: 'Only production can start a production run', status: 403 }
    }

    const order = await ProductionOrderRepository.findById(id)
    if (!order) {
      return { success: false, error: 'Production order not found', status: 404 }
    }
    if (order.status !== ProductionStatus.APPROVED) {
      return {
        success: false,
        error:   `This order is ${order.status === ProductionStatus.DRAFT ? 'still a draft' : order.status.replace(/_/g, ' ').toLowerCase()} — only an approved order can be started`,
        status:  409,
      }
    }

    const started = await ProductionOrderRepository.start(id, viewer.userId)
    if (!started) {
      return { success: false, error: 'This order changed just now — reload and try again', status: 409 }
    }
    return { success: true, data: { id: order.id, orderNumber: order.orderNumber } }
  },

  /**
   * IN_PROGRESS → PENDING_COMPLETION: the kitchen reports the run done with
   * what it actually yielded (Week 6 Task 1). Nothing moves in stock yet —
   * accounting signs the completion off first, and the order keeps counting
   * as committed until then (W6-1). No date rule, like start (D8).
   *
   * A zero yield is not a completion: a run that produced nothing is a
   * write-off (Week 7).
   */
  async complete(
    id: string,
    viewer: Viewer,
    actualQty: string,
  ): Promise<ProductionOrderResult<{ id: string; orderNumber: string }>> {
    if (!canPlan(viewer.role)) {
      return { success: false, error: 'Only production can complete a production run', status: 403 }
    }

    const order = await ProductionOrderRepository.findById(id)
    if (!order) {
      return { success: false, error: 'Production order not found', status: 404 }
    }
    if (order.status !== ProductionStatus.IN_PROGRESS) {
      return {
        success: false,
        error:   order.status === ProductionStatus.PENDING_COMPLETION
          ? 'This run has already been reported complete and is waiting for accounting'
          : `This order is ${order.status === ProductionStatus.DRAFT ? 'still a draft' : order.status.replace(/_/g, ' ').toLowerCase()} — only a run in progress can be completed`,
        status:  409,
      }
    }

    const yieldQty = toDecimal(actualQty)
    const unit     = order.bom.batchUnit.abbreviation
    if (yieldQty.lessThanOrEqualTo(0)) {
      return { success: false, error: 'The actual yield must be greater than zero — a run that produced nothing is a write-off', status: 400 }
    }
    const maxYield = order.plannedQty.mul(MAX_YIELD_FACTOR)
    if (yieldQty.greaterThan(maxYield)) {
      return {
        success: false,
        error:   `The actual yield cannot be more than ${MAX_YIELD_FACTOR} × the planned ${trimDecimal(toDecimalString(order.plannedQty))} ${unit} (${trimDecimal(toDecimalString(maxYield))} ${unit}) — check the figure`,
        status:  400,
      }
    }

    const completed = await ProductionOrderRepository.complete(id, {
      completedById: viewer.userId,
      actualQty:     yieldQty,
      note:          `Yield ${trimDecimal(toDecimalString(yieldQty))} ${unit}`,
    })
    if (!completed) {
      return { success: false, error: 'This order changed just now — reload and try again', status: 409 }
    }

    await enqueue(PRODUCTION_COMPLETION_REPORTED, id)
    return { success: true, data: { id: order.id, orderNumber: order.orderNumber } }
  },

  /**
   * Accounting's decision on a reported completion (Week 6 Task 2). Called
   * from POST /api/approvals with referenceType 'ProductionCompletion', which
   * middleware restricts to ACCOUNTING and ADMIN.
   *
   * Approving deducts every ingredient of the pinned BOM at the planned
   * quantity (D2 — what the recipe says the run used; over- or under-use shows
   * as yield) and adds the actual yield as a new lot, numbered after the order,
   * produced on the day the kitchen reported it (D6). Stock may go negative
   * (D3). Rejecting sends the run back to the kitchen (D4).
   *
   * Whoever reported the completion cannot decide it, ADMIN included (D1).
   */
  async applyCompletionDecision(
    id: string,
    viewer: Viewer,
    decision: 'APPROVED' | 'REJECTED',
    remarks: string | null,
  ): Promise<ProductionOrderResult<{ id: string; orderNumber: string }>> {
    const order = await ProductionOrderRepository.findById(id)
    if (!order) {
      return { success: false, error: 'Production order not found', status: 404 }
    }

    if (order.completedBy?.id === viewer.userId) {
      return {
        success: false,
        error:   'You reported this completion, so someone else has to decide it',
        status:  403,
      }
    }

    if (order.status !== ProductionStatus.PENDING_COMPLETION || order.completedAt === null || order.actualQty === null) {
      return {
        success: false,
        error:   `This order is ${order.status.replace(/_/g, ' ').toLowerCase()} — there is no reported completion to decide`,
        status:  409,
      }
    }

    if (decision === 'REJECTED' && (remarks === null || remarks.trim() === '')) {
      return { success: false, error: 'Give a reason when rejecting, so the kitchen knows what to correct', status: 400 }
    }

    let decided: boolean
    if (decision === 'REJECTED') {
      decided = await ProductionOrderRepository.decideCompletion({
        id, approverId: viewer.userId, remarks, completedAt: order.completedAt, decision: { kind: 'REJECTED' },
      })
    } else {
      // A lot without an expiry could never be flagged, and cannot be given
      // one afterwards (Week 6 Task 4, D3): a one-time setting per finished good.
      const expiresAt = lotExpiry(order.completedAt, order.finishedGood.shelfLifeHours)
      if (expiresAt === null) {
        return {
          success: false,
          error:   `${order.finishedGood.name} has no shelf life — an admin sets it in Master Data (Finished Goods), then approve`,
          status:  409,
        }
      }

      const bom = await BomRepository.findById(order.bom.id)
      if (!bom) {
        return { success: false, error: 'The BOM this order is pinned to no longer exists', status: 404 }
      }

      // One movement per material, even if a BOM lists one twice — the same
      // figures the approver's preview showed.
      const consumption = consumptionByMaterial(bom, order.batchWeight, order.plannedQty)

      // The cost is part of what accounting approves (Week 6 Task 3, D5): with
      // a price missing on either date it cannot be worked out, and a partial
      // cost would be stored wrong for good, so nothing is approved.
      const producedOn = isoDateAt(order.completedAt)
      const plannedOn  = order.plannedDate.toISOString().slice(0, 10)
      const [planned, actual] = await Promise.all([
        costRun(bom, order, plannedOn, order.plannedQty),
        costRun(bom, order, producedOn, order.actualQty),
      ])
      if (planned.total === null || actual.total === null) {
        // On the same date both lists are the same; name each gap once.
        const gaps = actual.dto.missing.map(name => `${name} on ${producedOn}`)
        if (plannedOn !== producedOn) gaps.push(...planned.dto.missing.map(name => `${name} on ${plannedOn}`))
        return {
          success: false,
          error:   `No reference price for ${gaps.join(', ')} — an admin adds one in Master Data (it may be back-dated), then approve`,
          status:  409,
        }
      }
      const unitPrices  = actual.prices
      const costPerUnit = actual.total.div(order.actualQty)

      decided = await ProductionOrderRepository.decideCompletion({
        id,
        approverId:  viewer.userId,
        remarks,
        completedAt: order.completedAt,
        decision: {
          kind:        'APPROVED',
          branchId:    order.branch.id,
          orderNumber: order.orderNumber,
          consumption: [...consumption]
            .filter(([, line]) => line.quantity.greaterThan(0))
            .flatMap(([materialId, line]) => {
              // Always present: actual.total is non-null only when every line was priced.
              const unitCost = unitPrices.get(materialId)
              return unitCost ? [{ materialId, quantity: line.quantity, unitCost }] : []
            }),
          lot: {
            lotNumber:         order.orderNumber,
            finishedGoodId:    order.finishedGood.id,
            productionOrderId: order.id,
            quantity:          order.actualQty,
            unitCost:          costPerUnit,
            // The Manila day the kitchen reported it done, stored as UTC midnight.
            producedOn:        new Date(producedOn),
            expiresAt,
          },
          costs: {
            plannedCost:  planned.total,
            actualCost:   actual.total,
            costPerUnit,
            costVariance: costVariance(planned.total, order.plannedQty, actual.total, order.actualQty),
          },
        },
      })
    }

    if (!decided) {
      return { success: false, error: 'This completion was decided or changed by someone else just now — reload and try again', status: 409 }
    }

    await enqueue(PRODUCTION_COMPLETION_DECIDED, id)
    return { success: true, data: { id: order.id, orderNumber: order.orderNumber } }
  },

  /**
   * DRAFT | PENDING_APPROVAL | APPROVED → CANCELLED, with a reason (D5).
   * Cancelling an approved order frees what it had committed: committed
   * stock only counts APPROVED and IN_PROGRESS orders.
   */
  async cancel(
    id: string,
    viewer: Viewer,
    reason: string,
  ): Promise<ProductionOrderResult<{ id: string; orderNumber: string }>> {
    if (!canPlan(viewer.role)) {
      return { success: false, error: 'Only production can cancel a production order', status: 403 }
    }
    if (reason.trim() === '') {
      return { success: false, error: 'Give a reason for cancelling', status: 400 }
    }

    const order = await ProductionOrderRepository.findById(id)
    if (!order) {
      return { success: false, error: 'Production order not found', status: 404 }
    }
    if (!CANCELLABLE_STATUSES.includes(order.status)) {
      return {
        success: false,
        error:   order.status === ProductionStatus.IN_PROGRESS
          ? 'This run is already in progress — ingredients are being used, so it cannot simply be cancelled'
          : order.status === ProductionStatus.CANCELLED
            ? 'This order is already cancelled'
            : `This order is ${order.status.replace(/_/g, ' ').toLowerCase()} and cannot be cancelled`,
        status:  409,
      }
    }

    const cancelled = await ProductionOrderRepository.cancel(id, {
      from:          order.status,
      cancelledById: viewer.userId,
      reason:        reason.trim(),
    })
    if (!cancelled) {
      return { success: false, error: 'This order changed just now — reload and try again', status: 409 }
    }
    return { success: true, data: { id: order.id, orderNumber: order.orderNumber } }
  },
}
