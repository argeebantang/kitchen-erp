import { MovementType, POStatus, PRStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * What the Reorder Recommender (Week 10 Task 4, Feature 4) reads besides stock
 * levels and the production schedule: how much each kitchen used, what is
 * already being bought, and who supplies each material.
 */

/** Purchase requests not yet turned into an order: what they ask for is coming, once ordered. */
export const OPEN_REQUEST_STATUSES: PRStatus[] = [PRStatus.DRAFT, PRStatus.PENDING_APPROVAL, PRStatus.APPROVED]

/**
 * Purchase orders with nothing received yet. A partly received order is left
 * out: nothing in the app says the supplier will still bring the rest (there
 * is no "close short"), and the history has dozens never made good.
 */
export const OPEN_ORDER_STATUSES: POStatus[] = [POStatus.DRAFT, POStatus.PENDING_APPROVAL, POStatus.APPROVED, POStatus.SENT]

export type UsageRow = { branchId: string; materialId: string; used: Prisma.Decimal }

export type OpenPurchaseLine = {
  kind: 'PR' | 'PO'
  documentId: string
  number: string
  status: string
  materialId: string
  quantity: Prisma.Decimal
  /** The kitchen it is for: the document's deliverToId (an order's, else its request's); null when not set. */
  deliverToId: string | null
  /** YYYY-MM-DD: the order's promised delivery, or the request's needed-by. */
  expected: string | null
}

export type MaterialSupplier = { materialId: string; supplierId: string; supplierName: string; from: 'order' | 'price' }

export const ReorderRepository = {
  /**
   * What left each kitchen's stock in [start, end), per material: production
   * and conversion ingredients (OUT) and anything written off (WASTE).
   * Positive quantities. Adjustments are corrections, not use.
   */
  async usage(branchIds: string[], materialIds: string[], window: { start: Date; end: Date }): Promise<UsageRow[]> {
    if (branchIds.length === 0 || materialIds.length === 0) return []
    const rows = await prisma.stockMovement.groupBy({
      by:    ['branchId', 'materialId'],
      where: {
        branchId:   { in: branchIds },
        materialId: { in: materialIds },
        type:       { in: [MovementType.OUT, MovementType.WASTE] },
        createdAt:  { gte: window.start, lt: window.end },
      },
      _sum: { quantity: true },
    })
    return rows.map(row => ({
      branchId:   row.branchId,
      materialId: row.materialId,
      used:       (row._sum.quantity ?? new Prisma.Decimal(0)).negated(),
    }))
  },

  /** Every open request and order line for these materials, whichever kitchen it is for. */
  async openPurchaseLines(materialIds: string[]): Promise<OpenPurchaseLine[]> {
    if (materialIds.length === 0) return []
    const [requestLines, orderLines] = await Promise.all([
      prisma.purchaseRequestItem.findMany({
        where:  { materialId: { in: materialIds }, purchaseRequest: { status: { in: OPEN_REQUEST_STATUSES } } },
        select: {
          materialId: true, quantity: true,
          purchaseRequest: { select: { id: true, prNumber: true, status: true, deliverToId: true, neededBy: true } },
        },
      }),
      prisma.purchaseOrderItem.findMany({
        where:  { materialId: { in: materialIds }, purchaseOrder: { status: { in: OPEN_ORDER_STATUSES } } },
        select: {
          materialId: true, quantity: true,
          purchaseOrder: {
            select: {
              id: true, poNumber: true, status: true, deliverToId: true, expectedDelivery: true,
              purchaseRequest: { select: { deliverToId: true } },
            },
          },
        },
      }),
    ])
    const dateOf = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null
    return [
      ...requestLines.map<OpenPurchaseLine>(line => ({
        kind: 'PR', documentId: line.purchaseRequest.id, number: line.purchaseRequest.prNumber,
        status: line.purchaseRequest.status, materialId: line.materialId, quantity: line.quantity,
        deliverToId: line.purchaseRequest.deliverToId,
        expected: dateOf(line.purchaseRequest.neededBy),
      })),
      ...orderLines.map<OpenPurchaseLine>(line => ({
        kind: 'PO', documentId: line.purchaseOrder.id, number: line.purchaseOrder.poNumber,
        status: line.purchaseOrder.status, materialId: line.materialId, quantity: line.quantity,
        deliverToId: line.purchaseOrder.deliverToId ?? line.purchaseOrder.purchaseRequest?.deliverToId ?? null,
        expected: dateOf(line.purchaseOrder.expectedDelivery),
      })),
    ]
  },

  /**
   * Who supplies each material: the supplier on its most recent purchase
   * order (rejected and cancelled ones aside), or else on its most recent
   * supplier price. A material with neither has no supplier yet.
   */
  async suppliers(materialIds: string[]): Promise<Map<string, MaterialSupplier>> {
    if (materialIds.length === 0) return new Map()
    const [ordered, priced] = await Promise.all([
      prisma.purchaseOrderItem.findMany({
        where: {
          materialId:    { in: materialIds },
          purchaseOrder: { supplierId: { not: null }, status: { notIn: [POStatus.REJECTED, POStatus.CANCELLED] } },
        },
        orderBy:  { purchaseOrder: { createdAt: 'desc' } },
        distinct: ['materialId'],
        select:   { materialId: true, purchaseOrder: { select: { supplier: { select: { id: true, name: true } } } } },
      }),
      prisma.itemPrice.findMany({
        where:    { materialId: { in: materialIds }, supplierId: { not: null } },
        orderBy:  { effectiveDate: 'desc' },
        distinct: ['materialId'],
        select:   { materialId: true, supplier: { select: { id: true, name: true } } },
      }),
    ])
    const result = new Map<string, MaterialSupplier>()
    for (const row of priced) {
      if (row.supplier) result.set(row.materialId, { materialId: row.materialId, supplierId: row.supplier.id, supplierName: row.supplier.name, from: 'price' })
    }
    for (const row of ordered) {
      const supplier = row.purchaseOrder.supplier
      if (supplier) result.set(row.materialId, { materialId: row.materialId, supplierId: supplier.id, supplierName: supplier.name, from: 'order' })
    }
    return result
  },
}
