import { Prisma, TransferStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Transfer Orders (Week 8 Task 2): finished goods sent from a commissary to
 * another branch. Stock moves only from Task 3 (dispatch on approval,
 * arrival on receipt), through FinishedGoodStockRepository.
 */

const stockTransferInclude = {
  fromBranch:  { select: { id: true, name: true, code: true } },
  toBranch:    { select: { id: true, name: true, code: true } },
  submittedBy: { select: { id: true, name: true } },
  items: {
    include: {
      finishedGood: { select: { id: true, code: true, name: true, unit: { select: { abbreviation: true } } } },
    },
    orderBy: { finishedGood: { name: 'asc' } },
  },
} satisfies Prisma.StockTransferInclude

export type StockTransferWithDetail = Prisma.StockTransferGetPayload<{ include: typeof stockTransferInclude }>

export type CreateStockTransferInput = {
  fromBranchId: string
  toBranchId: string
  submittedById: string
  notes: string | null
  items: { finishedGoodId: string; quantity: Prisma.Decimal }[]
}

export type StockTransferListFilters = {
  status?: TransferStatus
  /** Transfers from or to this branch. */
  branchId?: string
  skip?: number
  take?: number
}

export const StockTransferRepository = {
  /**
   * Inserts a transfer numbered TRF-000001 from trf_number_seq, already
   * PENDING_APPROVAL — recording it submits it (T6) — with its lines, in one
   * transaction with the nextval(), like every other document number.
   */
  async create(input: CreateStockTransferInput): Promise<{ id: string; transferNumber: string }> {
    return prisma.$transaction(async tx => {
      const [row] = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('trf_number_seq')`
      const transferNumber = `TRF-${row.nextval.toString().padStart(6, '0')}`

      return tx.stockTransfer.create({
        data: {
          transferNumber,
          status:        TransferStatus.PENDING_APPROVAL,
          fromBranchId:  input.fromBranchId,
          toBranchId:    input.toBranchId,
          submittedById: input.submittedById,
          notes:         input.notes,
          items:         { create: input.items },
        },
        select: { id: true, transferNumber: true },
      })
    })
  },

  async findById(id: string): Promise<StockTransferWithDetail | null> {
    return prisma.stockTransfer.findUnique({ where: { id }, include: stockTransferInclude })
  },

  /**
   * How much of a finished good pending transfers from a branch have claimed
   * but not yet taken (T8): it leaves the sender's lots only when accounting
   * approves (Task 3), so until then it is spoken for. Served by
   * @@index([status]).
   */
  async pendingFromBranch(finishedGoodId: string, branchId: string, excludeId: string | null): Promise<Prisma.Decimal> {
    const { _sum } = await prisma.stockTransferItem.aggregate({
      where: {
        finishedGoodId,
        stockTransfer: {
          status:       TransferStatus.PENDING_APPROVAL,
          fromBranchId: branchId,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
      },
      _sum: { quantity: true },
    })
    return _sum.quantity ?? new Prisma.Decimal(0)
  },

  async findMany(filters: StockTransferListFilters = {}) {
    const where: Prisma.StockTransferWhereInput = {}
    if (filters.status) where.status = filters.status
    if (filters.branchId) where.OR = [{ fromBranchId: filters.branchId }, { toBranchId: filters.branchId }]

    const [rows, total] = await prisma.$transaction([
      prisma.stockTransfer.findMany({
        where,
        include: stockTransferInclude,
        orderBy: { createdAt: 'desc' },
        skip:    filters.skip ?? 0,
        take:    filters.take ?? 50,
      }),
      prisma.stockTransfer.count({ where }),
    ])
    return { rows, total }
  },
}
