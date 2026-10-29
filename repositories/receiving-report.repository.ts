import { Prisma, RRStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export type ReceivingReportLineInput = {
  purchaseOrderItemId: string
  materialId: string
  orderedQuantity: Prisma.Decimal
  expectedQuantity: Prisma.Decimal
  receivedQuantity: Prisma.Decimal
  rejectedQuantity: Prisma.Decimal
  unitCost: Prisma.Decimal
  notes: string | null
}

export type CreateReceivingReportInput = {
  purchaseOrderId: string
  branchId: string
  receivedById: string
  receivedAt: Date
  notes: string | null
  lines: ReceivingReportLineInput[]
}

/** A report that still counts as "in progress" on its order. */
const OPEN_STATUSES: RRStatus[] = [RRStatus.DRAFT, RRStatus.PENDING_APPROVAL]

export const ReceivingReportRepository = {
  async findMany(filters: ReceivingReportListFilters = {}) {
    const where: Prisma.ReceivingReportWhereInput = {}
    if (filters.status)          where.status          = filters.status
    if (filters.purchaseOrderId) where.purchaseOrderId = filters.purchaseOrderId

    const [rows, total] = await prisma.$transaction([
      prisma.receivingReport.findMany({
        where,
        include: summaryInclude,
        orderBy: { createdAt: 'desc' },
        skip:    filters.skip ?? 0,
        take:    filters.take ?? 50,
      }),
      prisma.receivingReport.count({ where }),
    ])

    return { rows, total }
  },

  /**
   * How many lines of each report have a variance, counted by the database in
   * one query for a whole page of reports. A line has one exactly when
   * something was rejected or less than expected arrived: over-delivery is
   * always entered as rejected, and with nothing rejected, short means
   * received < expected. `fields.expectedQuantity` compares two columns of the
   * same row, which plain values cannot. Reports with no variance are absent.
   */
  async varianceLineCounts(reportIds: string[]): Promise<Map<string, number>> {
    if (reportIds.length === 0) return new Map()

    const rows = await prisma.receivingReportItem.groupBy({
      by:    ['receivingReportId'],
      where: {
        receivingReportId: { in: reportIds },
        OR: [
          { rejectedQuantity: { gt: 0 } },
          { receivedQuantity: { lt: prisma.receivingReportItem.fields.expectedQuantity } },
        ],
      },
      _count: { _all: true },
    })

    return new Map(rows.map(row => [row.receivingReportId, row._count._all]))
  },

  async findById(id: string): Promise<ReceivingReportWithDetail | null> {
    return prisma.receivingReport.findUnique({ where: { id }, include: detailInclude })
  },

  /**
   * Accepted quantity (received − rejected) per purchase order line, summed
   * over APPROVED reports only. A draft or pending report has not moved any
   * stock, and a rejected one never will, so neither reduces what is owed.
   *
   * One grouped query for the whole order, rather than one per line.
   */
  async acceptedByLine(purchaseOrderId: string): Promise<Map<string, Prisma.Decimal>> {
    const groups = await prisma.receivingReportItem.groupBy({
      by:    ['purchaseOrderItemId'],
      where: { receivingReport: { purchaseOrderId, status: RRStatus.APPROVED } },
      _sum:  { receivedQuantity: true, rejectedQuantity: true },
    })

    return new Map(
      groups.map(group => [
        group.purchaseOrderItemId,
        (group._sum.receivedQuantity ?? new Prisma.Decimal(0))
          .sub(group._sum.rejectedQuantity ?? new Prisma.Decimal(0)),
      ]),
    )
  },

  /** The DRAFT or PENDING_APPROVAL report on this order, if there is one. */
  async findOpenByPurchaseOrder(purchaseOrderId: string): Promise<{ id: string; rrNumber: string } | null> {
    return prisma.receivingReport.findFirst({
      where:  { purchaseOrderId, status: { in: OPEN_STATUSES } },
      select: { id: true, rrNumber: true },
    })
  },

  /**
   * Creates a DRAFT report with its lines. The number comes from
   * rr_number_seq inside the same transaction as the insert, the same way
   * PurchaseOrderRepository.createDraftFromRequest draws a PO number. A
   * rolled-back insert burns a number; gaps are fine, duplicates are not.
   */
  async create(input: CreateReceivingReportInput): Promise<{ id: string; rrNumber: string }> {
    return prisma.$transaction(async tx => {
      const [row] = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('rr_number_seq')`
      const rrNumber = `RR-${row.nextval.toString().padStart(6, '0')}`

      return tx.receivingReport.create({
        data: {
          rrNumber,
          purchaseOrderId: input.purchaseOrderId,
          branchId:        input.branchId,
          receivedById:    input.receivedById,
          receivedAt:      input.receivedAt,
          notes:           input.notes,
          status:          RRStatus.DRAFT,
          items: { create: input.lines },
        },
        select: { id: true, rrNumber: true },
      })
    })
  },

  /**
   * Rewrites a DRAFT report's header and counts in one transaction. Returns
   * null if the report stopped being a draft before the UPDATE ran: the status
   * sits in the WHERE clause (updateMany, since update() only filters on
   * unique fields), the same race guard as PurchaseOrderRepository's
   * moveStatus. A submit that wins the race means the edit writes nothing.
   *
   * orderedQuantity, unitCost and materialId are not rewritten: they are
   * copies of the order line, which cannot change once the order is approved.
   * expectedQuantity is, because it is outstanding as of this save.
   */
  async updateDraft(input: {
    id: string
    branchId: string
    receivedById: string
    receivedAt: Date
    notes: string | null
    lines: Pick<ReceivingReportLineInput, 'purchaseOrderItemId' | 'expectedQuantity' | 'receivedQuantity' | 'rejectedQuantity' | 'notes'>[]
  }): Promise<{ id: string; rrNumber: string } | null> {
    return prisma.$transaction(async tx => {
      const { count } = await tx.receivingReport.updateMany({
        where: { id: input.id, status: RRStatus.DRAFT },
        data: {
          branchId:     input.branchId,
          receivedById: input.receivedById,
          receivedAt:   input.receivedAt,
          notes:        input.notes,
        },
      })
      if (count === 0) return null

      // One UPDATE per line, bounded by the lines on one order and inside one
      // transaction — the same trade-off as PurchaseOrderRepository.updateDraft.
      for (const line of input.lines) {
        await tx.receivingReportItem.updateMany({
          where: { receivingReportId: input.id, purchaseOrderItemId: line.purchaseOrderItemId },
          data: {
            expectedQuantity: line.expectedQuantity,
            receivedQuantity: line.receivedQuantity,
            rejectedQuantity: line.rejectedQuantity,
            notes:            line.notes,
          },
        })
      }

      return tx.receivingReport.findUniqueOrThrow({
        where:  { id: input.id },
        select: { id: true, rrNumber: true },
      })
    })
  },
}

/** A report is never shown without its lines, its order, or who counted it. */
const detailInclude = {
  purchaseOrder: { select: { id: true, poNumber: true, status: true, supplier: { select: { name: true } } } },
  branch:        { select: { id: true, name: true } },
  receivedBy:    { select: { id: true, name: true } },
  items: {
    include: {
      material: {
        select: {
          code: true, name: true,
          unit: { select: { abbreviation: true } },
        },
      },
    },
    orderBy: { material: { name: 'asc' } },
  },
} satisfies Prisma.ReceivingReportInclude

export type ReceivingReportWithDetail = Prisma.ReceivingReportGetPayload<{
  include: typeof detailInclude
}>

/** What a list row shows: the order and supplier, where, and who counted it. */
const summaryInclude = {
  purchaseOrder: { select: { id: true, poNumber: true, supplier: { select: { name: true } } } },
  branch:        { select: { name: true } },
  receivedBy:    { select: { name: true } },
  _count:        { select: { items: true } },
} satisfies Prisma.ReceivingReportInclude

export type ReceivingReportSummary = Prisma.ReceivingReportGetPayload<{
  include: typeof summaryInclude
}>

export type ReceivingReportListFilters = {
  status?: RRStatus
  purchaseOrderId?: string
  skip?: number
  take?: number
}
