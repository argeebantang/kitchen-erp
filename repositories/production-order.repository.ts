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
 * Orders whose ingredients are spoken for but still on the shelf: approved,
 * or running and not yet completed. Stock is only deducted on completion
 * (Week 6), so until then the stock check subtracts what these still need.
 */
const COMMITTING_STATUSES: ProductionStatus[] = [ProductionStatus.APPROVED, ProductionStatus.IN_PROGRESS]

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
} as const

export type ProductionOrderWithDetail = Prisma.ProductionOrderGetPayload<{ include: typeof orderInclude }>

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
   * being a draft first (status in the WHERE, as in updateDraft). The bomId
   * the service checked is in the WHERE too: an edit landing between the
   * check and this UPDATE re-pins the BOM, and then nothing is submitted.
   */
  async submit(id: string, input: { submittedById: string; bomId: string }): Promise<boolean> {
    const { count } = await prisma.productionOrder.updateMany({
      where: { id, status: ProductionStatus.DRAFT, bomId: input.bomId },
      data:  { status: ProductionStatus.PENDING_APPROVAL, submittedById: input.submittedById },
    })
    return count === 1
  },

  /**
   * PENDING_APPROVAL → APPROVED | REJECTED and the Approval row, in one
   * transaction. The status moves first: if another decision got there
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
      const { count } = await tx.productionOrder.updateMany({
        where: { id: input.id, status: ProductionStatus.PENDING_APPROVAL },
        data:  { status: input.decision === 'APPROVED' ? ProductionStatus.APPROVED : ProductionStatus.REJECTED },
      })
      if (count === 0) return false

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
}
