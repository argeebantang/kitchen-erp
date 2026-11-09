import { Prisma, ProductionStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { bomDetailInclude } from '@/repositories/bom.repository'

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
  finishedGood: { select: { id: true, code: true, name: true } },
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

  async findById(id: string): Promise<ProductionOrderWithDetail | null> {
    return prisma.productionOrder.findUnique({ where: { id }, include: orderInclude })
  },

  /**
   * Orders awaiting a decision, each with its pinned BOM's lines, for the
   * approvals inbox's shortage badge — one query, oldest submission first so
   * the longest-waiting order heads the list. The bom include is a superset
   * of orderInclude's, so a row still fits ProductionOrderWithDetail.
   */
  async findPendingWithBom(take = 100) {
    return prisma.productionOrder.findMany({
      where:   { status: ProductionStatus.PENDING_APPROVAL },
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
   */
  async complete(id: string, input: { completedById: string; actualQty: Prisma.Decimal }): Promise<boolean> {
    return prisma.$transaction(tx => transition(tx, {
      id,
      from:        ProductionStatus.IN_PROGRESS,
      to:          ProductionStatus.PENDING_COMPLETION,
      changedById: input.completedById,
      data:        { actualQty: input.actualQty, completedAt: new Date(), completedById: input.completedById },
    }))
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
