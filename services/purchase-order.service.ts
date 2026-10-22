import { POStatus, Prisma, Role } from '@prisma/client'
import { toDecimalString } from '@/lib/decimal'
import {
  PurchaseOrderRepository,
  PurchaseOrderListFilters,
  PurchaseOrderWithDetail,
} from '@/repositories/purchase-order.repository'
import { ItemPriceRepository } from '@/repositories/item-price.repository'
import { SupplierRepository } from '@/repositories/supplier.repository'
import { ApprovalRepository } from '@/repositories/approval.repository'
import type { ApprovalDto } from '@/services/purchase-request.service'


export type PurchaseOrderLineDto = {
  id: string
  materialId: string
  materialCode: string
  materialName: string
  unitAbbreviation: string
  quantity: string
  unitCost: string
  totalCost: string
}

export type PurchaseOrderDetailDto = {
  decisions: ApprovalDto[]  
  id: string
  poNumber: string
  status: POStatus
  supplierId: string | null
  supplierName: string | null
  supplierEmail: string | null
  supplierPhone: string | null
  supplierAddress: string | null
  purchaseRequestId: string | null
  submittedById: string | null
  prNumber: string | null
  expectedDelivery: string | null
  notes: string | null
  totalAmount: string
  createdAt: string
  lines: PurchaseOrderLineDto[]
}

export type PurchaseOrderSummaryDto = {
  id: string
  poNumber: string
  status: POStatus
  supplierName: string | null
  prNumber: string | null
  lineCount: number
  totalAmount: string
  expectedDelivery: string | null
  createdAt: string
}

export type PurchaseOrderResult<T> =
  | { success: true;  data: T }
  | { success: false; error: string; status: number }



export type UpdatePurchaseOrderInput = {
  supplierId?: string | null
  expectedDelivery?: string | null
  notes?: string | null
}

type Viewer = { userId: string; role: string }

function statusText(status: POStatus) {
  return status.replace(/_/g, ' ').toLowerCase()
}

function canSource(role: string) {
  return role === Role.PROCUREMENT_MANAGER || role === Role.ADMIN
}

async function toDetailDto(po: PurchaseOrderWithDetail): Promise<PurchaseOrderDetailDto> {
  const decisions = await ApprovalRepository.findByReference('PurchaseOrder', po.id)
  return {
    id:                po.id,
    poNumber:          po.poNumber,
    status:            po.status,
    supplierId:        po.supplierId,
    supplierName:      po.supplier?.name ?? null,
    supplierEmail:     po.supplier?.email ?? null,
    supplierPhone:     po.supplier?.phone ?? null,
    supplierAddress:   po.supplier?.address ?? null,
    purchaseRequestId: po.purchaseRequestId,
    submittedById:     po.submittedById,
    prNumber:          po.purchaseRequest?.prNumber ?? null,
    expectedDelivery:  po.expectedDelivery?.toISOString() ?? null,
    notes:             po.notes,
    totalAmount:       toDecimalString(po.totalAmount),
    createdAt:         po.createdAt.toISOString(),
    lines: po.items.map(item => ({
      id:               item.id,
      materialId:       item.materialId,
      materialCode:     item.material.code,
      materialName:     item.material.name,
      unitAbbreviation: item.material.unit.abbreviation,
      quantity:         toDecimalString(item.quantity),
      unitCost:         toDecimalString(item.unitCost),
      totalCost:        toDecimalString(item.totalCost),
    })),
    decisions: decisions.map(decision => ({
      id:           decision.id,
      decision:     decision.decision,
      remarks:      decision.remarks,
      approverName: decision.approver.name,
      decidedAt:    decision.decidedAt.toISOString(),
    })),
  }
}

export const PurchaseOrderService = {
  /**
   * No viewer scoping, unlike purchase requests. A purchase request belongs to
   * whoever raised it; a purchase order belongs to the organisation. Every role
   * that middleware.ts lets reach /procurement/orders — ADMIN,
   * PROCUREMENT_MANAGER, ACCOUNTING — needs the whole picture to source or to
   * approve.
   */
  async list(filters: PurchaseOrderListFilters = {}) {
    const { rows, total } = await PurchaseOrderRepository.findMany(filters)

    return {
      purchaseOrders: rows.map<PurchaseOrderSummaryDto>(po => ({
        id:               po.id,
        poNumber:         po.poNumber,
        status:           po.status,
        supplierName:     po.supplier?.name ?? null,
        prNumber:         po.purchaseRequest?.prNumber ?? null,
        lineCount:        po._count.items,
        totalAmount:      toDecimalString(po.totalAmount),
        expectedDelivery: po.expectedDelivery?.toISOString() ?? null,
        createdAt:        po.createdAt.toISOString(),
      })),
      total,
    }
  },

    async getById(id: string): Promise<PurchaseOrderResult<PurchaseOrderDetailDto>> {
    const po = await PurchaseOrderRepository.findById(id)
    if (!po) {
      return { success: false, error: 'Purchase order not found', status: 404 }
    }
    return { success: true, data: await toDetailDto(po) }
  },

  /**
   * Edits a DRAFT order and re-prices every line for the chosen supplier.
   *
   * The role check lives here rather than in middleware because it is not a
   * path rule: accounting must reach /api/purchase-orders to approve orders,
   * but sourcing is procurement's job. Same URL, different action.
   */
  async updateDraft(
    id: string,
    input: UpdatePurchaseOrderInput,
    viewer: { role: string },
  ): Promise<PurchaseOrderResult<PurchaseOrderDetailDto>> {
    if (viewer.role !== Role.PROCUREMENT_MANAGER && viewer.role !== Role.ADMIN) {
      return { success: false, error: 'Only procurement can edit a purchase order', status: 403 }
    }

    const po = await PurchaseOrderRepository.findById(id)
    if (!po) {
      return { success: false, error: 'Purchase order not found', status: 404 }
    }

    if (po.status !== POStatus.DRAFT) {
      return {
        success: false,
        error:   `This order is ${po.status.replace(/_/g, ' ').toLowerCase()} and can no longer be edited`,
        status:  409,
      }
    }

    const supplierId = input.supplierId ?? null

    if (supplierId !== null && (await SupplierRepository.findById(supplierId)) === null) {
      return { success: false, error: 'Supplier not found', status: 400 }
    }

    // One query prices every line. A null supplierId resolves to reference
    // prices, which is also what un-setting a supplier should do.
    const prices = await ItemPriceRepository.findPricesAsOf(
      po.items.map(item => item.materialId),
      new Date(),
      supplierId,
    )

    let totalAmount = new Prisma.Decimal(0)

    const lines = po.items.map(item => {
      // Keep the existing cost when nothing is on record, rather than zeroing a
      // line that was already priced when the order was created.
      const unitCost  = prices.get(item.materialId)?.unitPrice ?? item.unitCost
      const totalCost = unitCost.mul(item.quantity)
      totalAmount = totalAmount.add(totalCost)
      return { id: item.id, unitCost, totalCost }
    })

    const updated = await PurchaseOrderRepository.updateDraft({
      id,
      supplierId,
      expectedDelivery: input.expectedDelivery ? new Date(input.expectedDelivery) : null,
      notes:            input.notes ?? null,
      totalAmount,
      lines,
    })

    return { success: true, data: await toDetailDto(updated) }
  },

   /**
   * DRAFT → PENDING_APPROVAL. Procurement only, and only with a supplier: the
   * schema allows a null supplierId (a PR never names one), so this is the one
   * place that guarantees an order reaching accounting can actually be sent.
   */
  async submit(id: string, viewer: Viewer): Promise<PurchaseOrderResult<PurchaseOrderDetailDto>> {
    if (!canSource(viewer.role)) {
      return { success: false, error: 'Only procurement can submit a purchase order', status: 403 }
    }

    const po = await PurchaseOrderRepository.findById(id)
    if (!po) {
      return { success: false, error: 'Purchase order not found', status: 404 }
    }

    if (po.status !== POStatus.DRAFT) {
      return {
        success: false,
        error:   `This order is already ${statusText(po.status)} and cannot be submitted`,
        status:  409,
      }
    }

    if (po.supplierId === null) {
      return { success: false, error: 'Choose a supplier before submitting', status: 400 }
    }

    if (po.items.length === 0) {
      return { success: false, error: 'A purchase order needs at least one line', status: 400 }
    }

    const updated = await PurchaseOrderRepository.submit({ id, submittedById: viewer.userId })
    if (!updated) {
      return { success: false, error: 'This order changed while you were submitting it — reload and try again', status: 409 }
    }

    return { success: true, data: await toDetailDto(updated) }
  },

  /**
   * PENDING_APPROVAL → APPROVED | REJECTED. Called from POST /api/approvals,
   * which middleware already restricts to ACCOUNTING and ADMIN.
   */
  async applyDecision(
    id: string,
    viewer: Viewer,
    decision: 'APPROVED' | 'REJECTED',
    remarks: string | null,
  ): Promise<PurchaseOrderResult<PurchaseOrderDetailDto>> {
    const po = await PurchaseOrderRepository.findById(id)
    if (!po) {
      return { success: false, error: 'Purchase order not found', status: 404 }
    }

    // submittedById is set once, while the order is a DRAFT, and never changes
    // after — so this read cannot go stale the way a status can. Null means the
    // order predates the column; there is nobody to compare against.
    if (po.submittedById !== null && po.submittedById === viewer.userId) {
      return {
        success: false,
        error:   'You cannot approve an order you submitted — someone else has to decide it',
        status:  403,
      }
    }

    if (po.status !== POStatus.PENDING_APPROVAL) {
      return {
        success: false,
        error:   `This order is ${statusText(po.status)} and is no longer awaiting a decision`,
        status:  409,
      }
    }

    if (decision === 'REJECTED' && (remarks === null || remarks.trim() === '')) {
      return { success: false, error: 'Give a reason when rejecting', status: 400 }
    }

    const updated = await PurchaseOrderRepository.decide({
      id,
      approverId: viewer.userId,
      decision,
      remarks,
    })
    if (!updated) {
      return { success: false, error: 'This order was decided by someone else just now', status: 409 }
    }

    return { success: true, data: await toDetailDto(updated) }
  },

  /** APPROVED → SENT. Procurement only. A status flip for now; no email goes out. */
  async markSent(id: string, viewer: Viewer): Promise<PurchaseOrderResult<PurchaseOrderDetailDto>> {
    if (!canSource(viewer.role)) {
      return { success: false, error: 'Only procurement can mark an order as sent', status: 403 }
    }

    const po = await PurchaseOrderRepository.findById(id)
    if (!po) {
      return { success: false, error: 'Purchase order not found', status: 404 }
    }

    if (po.status !== POStatus.APPROVED) {
      return {
        success: false,
        error:   `This order is ${statusText(po.status)} — only an approved order can be marked as sent`,
        status:  409,
      }
    }

    const updated = await PurchaseOrderRepository.markSent(id)
    if (!updated) {
      return { success: false, error: 'This order changed while you were saving — reload and try again', status: 409 }
    }

    return { success: true, data: await toDetailDto(updated) }
  },
}