import { Prisma, ProductionStatus } from '@prisma/client'
import { toDecimal, toDecimalString } from '@/lib/decimal'
import { todayIsoDate } from '@/lib/dates'
import {
  getNotificationQueue,
  PRODUCTION_ORDER_DECIDED,
  PRODUCTION_ORDER_SUBMITTED,
  type ProductionOrderJob,
} from '@/lib/queue'
import { ApprovalRepository } from '@/repositories/approval.repository'
import type { ApprovalDto } from '@/services/purchase-request.service'
import { trimDecimal } from '@/lib/format'
import { BomRepository, BomWithDetail } from '@/repositories/bom.repository'
import { scaleBomQuantities } from '@/services/bom.service'
import { BranchRepository } from '@/repositories/branch.repository'
import { InventoryRepository } from '@/repositories/inventory.repository'
import { FinishedGoodRepository } from '@/repositories/finished-good.repository'
import {
  ProductionOrderListFilters,
  ProductionOrderRepository,
  ProductionOrderWithDetail,
} from '@/repositories/production-order.repository'

/** Upper bound on batches per order: catches a typed 1000 for 10. */
export const MAX_BATCH_COUNT = 100

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
  /** Approve / reject decisions, newest first. */
  decisions: ApprovalDto[]
}

/** A row of the approvals inbox: the order plus how many ingredients are short right now. */
export type PendingProductionOrderDto = ProductionOrderSummaryDto & {
  ingredientCount: number
  shortCount: number
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

export type ProductionOrderResult<T> =
  | { success: true;  data: T }
  | { success: false; error: string; status: number }

type Viewer = { userId: string; role: string }

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
 * Statuses whose run is still ahead, so today's stock means something for it
 * (Task 3, D5). Once completed, rejected or cancelled, the check is hidden.
 */
const STOCK_CHECK_STATUSES: ProductionStatus[] = [
  ProductionStatus.DRAFT,
  ProductionStatus.PENDING_APPROVAL,
  ProductionStatus.APPROVED,
  ProductionStatus.IN_PROGRESS,
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
    const [pinned, active, decisions] = await Promise.all([
      BomRepository.findById(order.bomId),
      order.bom.isActive ? null : BomRepository.findActiveByFinishedGood(order.finishedGood.id),
      ApprovalRepository.findByReference('ProductionOrder', order.id),
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
        decisions: decisions.map(decision => ({
          id:           decision.id,
          decision:     decision.decision,
          remarks:      decision.remarks,
          approverName: decision.approver.name,
          decidedAt:    decision.decidedAt.toISOString(),
        })),
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
   * The approvals inbox: every order awaiting a decision, with how many of its
   * ingredients are short at its branch right now (Task 4 deferred the count
   * to here). Two stock queries per order, bounded by `take`.
   */
  async listPending(take = 100): Promise<PendingProductionOrderDto[]> {
    const orders = await ProductionOrderRepository.findPendingWithBom(take)

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
}
