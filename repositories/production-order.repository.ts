import { Prisma, ProductionStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'

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
}
