import { Prisma, ProductionStatus } from '@prisma/client'
import { toDecimal, toDecimalString } from '@/lib/decimal'
import { todayIsoDate } from '@/lib/dates'
import { BomRepository, BomWithDetail } from '@/repositories/bom.repository'
import { scaleBomQuantities } from '@/services/bom.service'
import { BranchRepository } from '@/repositories/branch.repository'
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
  createdAt: string
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
}

/** What a run would need, before it is saved — the form's preview. */
export type RequirementsPreviewDto = {
  /** The active version: the one a save would pin. */
  bomId: string
  bomVersion: number
  batchWeight: string
  batchCount: number
  plannedQty: string
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
    createdAt:        order.createdAt.toISOString(),
  }
}

/**
 * What a run needs, line by line. Both columns are scaled straight from the
 * BOM — per batch to batchWeight, total to plannedQty — rather than total =
 * per batch × batchCount, so the total never carries a rounded intermediate.
 * The units are the materials' own: BomService refuses a line in any other.
 *
 * The one place requirements are computed, so the detail page and the form's
 * preview cannot disagree.
 */
function materialRequirements(
  bom: BomWithDetail,
  batchWeight: Prisma.Decimal,
  plannedQty: Prisma.Decimal,
): MaterialRequirementDto[] {
  const perBatch = new Map(scaleBomQuantities(bom, batchWeight).map(line => [line.lineId, line.quantity]))
  const total    = new Map(scaleBomQuantities(bom, plannedQty).map(line => [line.lineId, line.quantity]))

  return bom.items.map(item => ({
    materialId:       item.materialId,
    materialCode:     item.material.code,
    materialName:     item.material.name,
    unitAbbreviation: item.unit.abbreviation,
    perBatch:         toDecimalString(perBatch.get(item.id) ?? item.quantity),
    total:            toDecimalString(total.get(item.id) ?? item.quantity),
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
    const [pinned, active] = await Promise.all([
      BomRepository.findById(order.bomId),
      order.bom.isActive ? null : BomRepository.findActiveByFinishedGood(order.finishedGood.id),
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
        requirements:     materialRequirements(pinned, order.batchWeight, order.plannedQty),
      },
    }
  },

  /**
   * The form's live preview: the active BOM scaled to a batch weight and count
   * that have not been saved yet. Read-only, so it checks only what the
   * calculation needs; branch, date and the unit rule are left to save, where
   * the form already shows them.
   */
  async previewRequirements(input: {
    finishedGoodId: string
    batchWeight: string
    batchCount: number
  }): Promise<ProductionOrderResult<RequirementsPreviewDto>> {
    const bom = await BomRepository.findActiveByFinishedGood(input.finishedGoodId)
    if (!bom) {
      return { success: false, error: 'This finished good has no active BOM', status: 404 }
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
        lines:       materialRequirements(bom, batchWeight, plannedQty),
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
}
