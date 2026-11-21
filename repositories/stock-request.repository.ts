import { Prisma, StockRequestStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Branch stock requests (Week 9 Task 10): an outlet asks a kitchen for
 * finished goods by a date. Status moves are guarded by the current status in
 * the WHERE, so two people deciding at once cannot both win.
 */

const stockRequestInclude = {
  branch:      { select: { id: true, name: true, code: true } },
  kitchen:     { select: { id: true, name: true, code: true } },
  submittedBy: { select: { id: true, name: true } },
  decidedBy:   { select: { id: true, name: true } },
  items: {
    include: {
      finishedGood: { select: { id: true, code: true, name: true, unit: { select: { abbreviation: true } } } },
    },
    orderBy: { finishedGood: { name: 'asc' } },
  },
  transfers: {
    select:  { id: true, transferNumber: true, status: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.StockRequestInclude

export type StockRequestWithDetail = Prisma.StockRequestGetPayload<{ include: typeof stockRequestInclude }>

export type StockRequestListFilters = {
  statuses?: StockRequestStatus[]
  /** The outlet asking. */
  branchId?: string
  kitchenId?: string
  /** neededOn on or after (midnight UTC of a business date). */
  neededFrom?: Date
  skip?: number
  take?: number
}

export const StockRequestRepository = {
  /** Inserts STR-000001 from str_number_seq, SUBMITTED, with its lines — in one transaction with the nextval(). */
  async create(input: {
    branchId: string
    kitchenId: string
    neededOn: Date
    late: boolean
    submittedById: string
    notes: string | null
    items: { finishedGoodId: string; quantity: Prisma.Decimal }[]
  }): Promise<{ id: string; requestNumber: string }> {
    return prisma.$transaction(async tx => {
      const [row] = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('str_number_seq')`
      const requestNumber = `STR-${row.nextval.toString().padStart(6, '0')}`
      return tx.stockRequest.create({
        data: {
          requestNumber,
          status:        StockRequestStatus.SUBMITTED,
          branchId:      input.branchId,
          kitchenId:     input.kitchenId,
          neededOn:      input.neededOn,
          late:          input.late,
          submittedById: input.submittedById,
          notes:         input.notes,
          items:         { create: input.items },
        },
        select: { id: true, requestNumber: true },
      })
    })
  },

  async findById(id: string): Promise<StockRequestWithDetail | null> {
    return prisma.stockRequest.findUnique({ where: { id }, include: stockRequestInclude })
  },

  /** Soonest needed first, then oldest. */
  async findMany(filters: StockRequestListFilters = {}): Promise<{ rows: StockRequestWithDetail[]; total: number }> {
    const where: Prisma.StockRequestWhereInput = {}
    if (filters.statuses?.length) where.status = { in: filters.statuses }
    if (filters.branchId) where.branchId = filters.branchId
    if (filters.kitchenId) where.kitchenId = filters.kitchenId
    if (filters.neededFrom) where.neededOn = { gte: filters.neededFrom }
    const [rows, total] = await prisma.$transaction([
      prisma.stockRequest.findMany({
        where,
        include: stockRequestInclude,
        orderBy: [{ neededOn: 'asc' }, { createdAt: 'asc' }],
        skip:    filters.skip ?? 0,
        take:    filters.take ?? 100,
      }),
      prisma.stockRequest.count({ where }),
    ])
    return { rows, total }
  },

  /**
   * SUBMITTED → PLANNED with each line's planned quantity, who and why, in one
   * transaction. False when it was no longer SUBMITTED.
   */
  async plan(input: { id: string; deciderId: string; note: string | null; planned: Map<string, Prisma.Decimal> }): Promise<boolean> {
    return prisma.$transaction(async tx => {
      const { count } = await tx.stockRequest.updateMany({
        where: { id: input.id, status: StockRequestStatus.SUBMITTED },
        data:  { status: StockRequestStatus.PLANNED, decidedById: input.deciderId, decidedAt: new Date(), kitchenNote: input.note },
      })
      if (count === 0) return false
      for (const [itemId, quantity] of input.planned) {
        await tx.stockRequestItem.update({ where: { id: itemId }, data: { plannedQuantity: quantity } })
      }
      return true
    })
  },

  /** SUBMITTED → DECLINED with who and why. False when it was no longer SUBMITTED. */
  async decline(input: { id: string; deciderId: string; note: string }): Promise<boolean> {
    const { count } = await prisma.stockRequest.updateMany({
      where: { id: input.id, status: StockRequestStatus.SUBMITTED },
      data:  { status: StockRequestStatus.DECLINED, decidedById: input.deciderId, decidedAt: new Date(), kitchenNote: input.note },
    })
    return count > 0
  },

  /** PLANNED → FULFILLED / PARTLY_FULFILLED when its delivery is received. False when it was not PLANNED. */
  async fulfil(id: string, status: typeof StockRequestStatus.FULFILLED | typeof StockRequestStatus.PARTLY_FULFILLED): Promise<boolean> {
    const { count } = await prisma.stockRequest.updateMany({
      where: { id, status: StockRequestStatus.PLANNED },
      data:  { status },
    })
    return count > 0
  },
}
