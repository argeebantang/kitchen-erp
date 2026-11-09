import { Prisma, ProductionStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { bomDetailInclude } from '@/repositories/bom.repository'
import { InventoryRepository } from '@/repositories/inventory.repository'
import { FinishedGoodStockRepository, ReceiveLotInput } from '@/repositories/finished-good-stock.repository'

export type CreateProductionOrderInput = {
  finishedGoodId: string
  /** The finished good's active BOM version at the moment of saving. */
  bomId: string
  branchId: string
  requestedById: string
  batchWeight: Prisma.Decimal
  batchCount: number
  plannedQty: Prisma.Decimal
  plannedDate: Date
  notes: string | null
}

/** What an edit may rewrite. orderNumber, requestedById and status never change here. */
export type UpdateProductionOrderDraftInput = Omit<CreateProductionOrderInput, 'requestedById'>

/**
 * Orders whose ingredients are spoken for but still on the books: approved,
 * running, or reported done and awaiting accounting's sign-off. Stock is only
 * deducted when the completion is approved (Week 6), so until then the stock
 * check subtracts what these still need.
 */
const COMMITTING_STATUSES: ProductionStatus[] = [
  ProductionStatus.APPROVED,
  ProductionStatus.IN_PROGRESS,
  ProductionStatus.PENDING_COMPLETION,
]

export type ProductionOrderListFilters = {
  status?: ProductionStatus
  skip?: number
  take?: number
}

/**
 * The finished good, the pinned BOM version and the people/places an order
 * names, in one query — a list row and the detail page both show them all.
 * bom.isActive tells a draft whose recipe has since been superseded.
 */
const orderInclude = {
  // shelfLifeHours: a completed run's lot expires that long after it was cooked (Week 6 Task 4).
  finishedGood: { select: { id: true, code: true, name: true, shelfLifeHours: true } },
  bom: {
    select: {
      id: true, version: true, isActive: true, batchSize: true,
      batchUnit: { select: { abbreviation: true } },
    },
  },
  branch:      { select: { id: true, name: true } },
  requestedBy: { select: { id: true, name: true } },
  submittedBy: { select: { id: true, name: true } },
  completedBy: { select: { id: true, name: true } },
} as const

export type ProductionOrderWithDetail = Prisma.ProductionOrderGetPayload<{ include: typeof orderInclude }>

/**
 * Every status change goes through here, on the caller's transaction: the
 * expected status sits in the UPDATE's WHERE (0 rows = someone else moved it
 * first → false, nothing written), and the ProductionStatusChange row is
 * written only when the update happened, so the log cannot disagree with the
 * status (Week 5 Task 6).
 */
async function transition(
  tx: Prisma.TransactionClient,
  input: {
    id: string
    from: ProductionStatus
    to: ProductionStatus
    changedById: string
    note?: string | null
    /** Extra conditions on the UPDATE, e.g. the bomId submit checked. */
    where?: Prisma.ProductionOrderWhereInput
    /** Extra columns set with the status, e.g. submittedById. */
    data?: Prisma.ProductionOrderUncheckedUpdateManyInput
  },
): Promise<boolean> {
  const { count } = await tx.productionOrder.updateMany({
    where: { ...input.where, id: input.id, status: input.from },
    data:  { ...input.data, status: input.to },
  })
  if (count === 0) return false

  await tx.productionStatusChange.create({
    data: {
      productionOrderId: input.id,
      fromStatus:        input.from,
      toStatus:          input.to,
      changedById:       input.changedById,
      note:              input.note ?? null,
    },
  })
  return true
}

export const ProductionOrderRepository = {
  async findMany(filters: ProductionOrderListFilters = {}) {
    const where: Prisma.ProductionOrderWhereInput = {}
    if (filters.status) where.status = filters.status

    const [rows, total] = await prisma.$transaction([
      prisma.productionOrder.findMany({
        where,
        include: orderInclude,
        orderBy: { createdAt: 'desc' },
        skip:    filters.skip ?? 0,
        take:    filters.take ?? 50,
      }),
      prisma.productionOrder.count({ where }),
    ])

    return { rows, total }
  },

  /**
   * Orders planned between two dates (inclusive, date-only values at UTC
   * midnight) — the schedule calendar's visible weeks. Served by
   * @@index([plannedDate]). Bounded by `take`; the caller asks for one more
   * than it shows to know whether it was cut short.
   */
  async findPlannedBetween(input: {
    from: Date
    to: Date
    statuses: ProductionStatus[]
    branchId?: string
    take: number
  }): Promise<ProductionOrderWithDetail[]> {
    return prisma.productionOrder.findMany({
      where: {
        plannedDate: { gte: input.from, lte: input.to },
        status:      { in: input.statuses },
        ...(input.branchId ? { branchId: input.branchId } : {}),
      },
      include: orderInclude,
      orderBy: [{ plannedDate: 'asc' }, { orderNumber: 'asc' }],
      take:    input.take,
    })
  },

  /** Order numbers for a batch of ids, for the Stock Ledger's source column — one query per page. */
  async numbersByIds(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map()
    const rows = await prisma.productionOrder.findMany({ where: { id: { in: ids } }, select: { id: true, orderNumber: true } })
    return new Map(rows.map(row => [row.id, row.orderNumber]))
  },

  async findById(id: string): Promise<ProductionOrderWithDetail | null> {
    return prisma.productionOrder.findUnique({ where: { id }, include: orderInclude })
  },

  /**
   * Orders awaiting a decision, each with its pinned BOM's lines, for the
   * approvals inbox — a plan (PENDING_APPROVAL, the shortage badge) or a
   * reported completion (PENDING_COMPLETION, the go-negative badge). One
   * query, longest-waiting first. The bom include is a superset of
   * orderInclude's, so a row still fits ProductionOrderWithDetail.
   */
  async findPendingWithBom(
    status: typeof ProductionStatus.PENDING_APPROVAL | typeof ProductionStatus.PENDING_COMPLETION,
    take = 100,
  ) {
    return prisma.productionOrder.findMany({
      where:   { status },
      include: { ...orderInclude, bom: { include: bomDetailInclude } },
      orderBy: { updatedAt: 'asc' },
      take,
    })
  },

  /**
   * The committing orders at a branch, each with its pinned BOM's lines, in
   * one query — the service scales them with the same function as the order
   * being checked. `excludeId` keeps an approved order from counting against
   * itself. Bounded by how many runs are approved but not yet completed.
   */
  async findCommittedAtBranch(branchId: string, excludeId: string | null) {
    return prisma.productionOrder.findMany({
      where: {
        branchId,
        status: { in: COMMITTING_STATUSES },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: {
        id: true, batchWeight: true, plannedQty: true,
        bom: { include: bomDetailInclude },
      },
    })
  },

  /**
   * Inserts a DRAFT order numbered PRD-000001 from prd_number_seq. nextval()
   * runs inside the same transaction as the insert, so a failed insert burns a
   * number (gaps are fine) but two saves can never share one.
   */
  async create(input: CreateProductionOrderInput): Promise<{ id: string; orderNumber: string }> {
    return prisma.$transaction(async tx => {
      const [row] = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('prd_number_seq')`
      const orderNumber = `PRD-${row.nextval.toString().padStart(6, '0')}`

      return tx.productionOrder.create({
        data: {
          ...input,
          orderNumber,
          status: ProductionStatus.DRAFT,
        },
        select: { id: true, orderNumber: true },
      })
    })
  },

  /**
   * Rewrites a DRAFT order. Returns false if it stopped being a draft before
   * the UPDATE ran: the status sits in the WHERE clause (updateMany, since
   * update() only filters on unique fields), the same race guard as
   * ReceivingReportRepository.updateDraft. A submit that wins the race means
   * the edit writes nothing.
   */
  async updateDraft(id: string, input: UpdateProductionOrderDraftInput): Promise<boolean> {
    const { count } = await prisma.productionOrder.updateMany({
      where: { id, status: ProductionStatus.DRAFT },
      data:  input,
    })
    return count === 1
  },

  /**
   * DRAFT → PENDING_APPROVAL, recording who sent it. False if it stopped
   * being a draft first. The bomId the service checked is in the WHERE too:
   * an edit landing between the check and this UPDATE re-pins the BOM, and
   * then nothing is submitted.
   */
  async submit(id: string, input: { submittedById: string; bomId: string }): Promise<boolean> {
    return prisma.$transaction(tx => transition(tx, {
      id,
      from:        ProductionStatus.DRAFT,
      to:          ProductionStatus.PENDING_APPROVAL,
      changedById: input.submittedById,
      where:       { bomId: input.bomId },
      data:        { submittedById: input.submittedById },
    }))
  },

  /**
   * PENDING_APPROVAL → APPROVED | REJECTED, its log row and the Approval row,
   * in one transaction. The status moves first: if another decision got there
   * before us, nothing is written and the result is false — the same order
   * as PurchaseOrderRepository.decide.
   */
  async decide(input: {
    id: string
    approverId: string
    decision: 'APPROVED' | 'REJECTED'
    remarks: string | null
  }): Promise<boolean> {
    return prisma.$transaction(async tx => {
      const moved = await transition(tx, {
        id:          input.id,
        from:        ProductionStatus.PENDING_APPROVAL,
        to:          input.decision === 'APPROVED' ? ProductionStatus.APPROVED : ProductionStatus.REJECTED,
        changedById: input.approverId,
        note:        input.remarks,
      })
      if (!moved) return false

      await tx.approval.create({
        data: {
          referenceType: 'ProductionOrder',
          referenceId:   input.id,
          approverId:    input.approverId,
          decision:      input.decision,
          remarks:       input.remarks,
        },
      })
      return true
    })
  },

  /** APPROVED → IN_PROGRESS (Week 5 Task 6). False if it was not approved by then. */
  async start(id: string, startedById: string): Promise<boolean> {
    return prisma.$transaction(tx => transition(tx, {
      id,
      from:        ProductionStatus.APPROVED,
      to:          ProductionStatus.IN_PROGRESS,
      changedById: startedById,
    }))
  },

  /**
   * IN_PROGRESS → PENDING_COMPLETION: the kitchen reports the run done with
   * its actual yield (Week 6 Task 1). The yield, when and who are set by the
   * same UPDATE as the status, so they cannot land on an order that had moved
   * on. False if it was not in progress by then. No stock moves here — that
   * happens when accounting approves the completion.
   *
   * `note` ("Yield 9.6 kg") goes on the log row: a rejection clears the
   * order's columns, and the append-only log keeps every report (Task 2, D4).
   */
  async complete(id: string, input: { completedById: string; actualQty: Prisma.Decimal; note: string }): Promise<boolean> {
    return prisma.$transaction(tx => transition(tx, {
      id,
      from:        ProductionStatus.IN_PROGRESS,
      to:          ProductionStatus.PENDING_COMPLETION,
      changedById: input.completedById,
      note:        input.note,
      data:        { actualQty: input.actualQty, completedAt: new Date(), completedById: input.completedById },
    }))
  },

  /**
   * Accounting's decision on a reported completion (Week 6 Task 2), all in
   * one transaction:
   *
   *   approve: PENDING_COMPLETION → COMPLETED and its log row, the Approval
   *            row, one OUT per ingredient, then the run's lot into
   *            finished-goods stock at the actual yield
   *   reject:  PENDING_COMPLETION → IN_PROGRESS with the reason, clearing the
   *            reported yield, and the Approval row
   *
   * `completedAt` is the report the service read and showed: it goes in the
   * UPDATE's WHERE, so if that report was rejected and a new one made in the
   * meantime, nothing is decided (false) — the stock written here was
   * computed from the old figure.
   *
   * Ingredients are written in materialId order. Two approvals that share
   * ingredients then lock the same InventoryLevel rows in the same order and
   * cannot deadlock (D2).
   */
  async decideCompletion(input: {
    id: string
    approverId: string
    remarks: string | null
    completedAt: Date
    decision:
      | { kind: 'REJECTED' }
      | {
          kind: 'APPROVED'
          branchId: string
          orderNumber: string
          /** unitCost: the reference price the run was costed at (Week 6 Task 3). */
          consumption: { materialId: string; quantity: Prisma.Decimal; unitCost: Prisma.Decimal }[]
          lot: Omit<ReceiveLotInput, 'branchId' | 'referenceType' | 'referenceId' | 'notes'>
          costs: { plannedCost: Prisma.Decimal; actualCost: Prisma.Decimal; costPerUnit: Prisma.Decimal; costVariance: Prisma.Decimal }
        }
  }): Promise<boolean> {
    return prisma.$transaction(async tx => {
      const approving = input.decision.kind === 'APPROVED'
      const moved = await transition(tx, {
        id:          input.id,
        from:        ProductionStatus.PENDING_COMPLETION,
        to:          approving ? ProductionStatus.COMPLETED : ProductionStatus.IN_PROGRESS,
        changedById: input.approverId,
        note:        input.remarks,
        where:       { completedAt: input.completedAt },
        // Approved: the cost is recorded with the status, never recomputed
        // (Week 6 Task 3, D4). Sent back: still cooking, so no reported yield
        // until the next report.
        data:        input.decision.kind === 'APPROVED'
          ? input.decision.costs
          : { actualQty: null, completedAt: null, completedById: null },
      })
      if (!moved) return false

      await tx.approval.create({
        data: {
          referenceType: 'ProductionCompletion',
          referenceId:   input.id,
          approverId:    input.approverId,
          decision:      input.decision.kind,
          remarks:       input.remarks,
        },
      })

      if (input.decision.kind === 'REJECTED') return true
      const approved = input.decision

      const byMaterial = [...approved.consumption].sort((a, b) => (a.materialId < b.materialId ? -1 : 1))
      for (const line of byMaterial) {
        await InventoryRepository.stockOut(tx, {
          materialId:    line.materialId,
          branchId:      approved.branchId,
          quantity:      line.quantity,
          unitCost:      line.unitCost,
          referenceType: 'ProductionOrder',
          referenceId:   input.id,
          notes:         approved.orderNumber,
        })
      }

      await FinishedGoodStockRepository.receiveLot(tx, {
        ...approved.lot,
        branchId:      approved.branchId,
        referenceType: 'ProductionOrder',
        referenceId:   input.id,
        notes:         approved.orderNumber,
      })
      return true
    })
  },

  /**
   * `from` → CANCELLED, with the reason on the log row. `from` is the status
   * the service read and allowed; if the order has moved since, nothing
   * changes and the result is false.
   */
  async cancel(id: string, input: { from: ProductionStatus; cancelledById: string; reason: string }): Promise<boolean> {
    return prisma.$transaction(tx => transition(tx, {
      id,
      from:        input.from,
      to:          ProductionStatus.CANCELLED,
      changedById: input.cancelledById,
      note:        input.reason,
    }))
  },

  /** An order's status changes, oldest first — the order page's timeline. */
  async findStatusChanges(productionOrderId: string) {
    return prisma.productionStatusChange.findMany({
      where:   { productionOrderId },
      include: { changedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    })
  },
}
