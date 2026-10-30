import { POStatus, Prisma, RRStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { InventoryRepository } from '@/repositories/inventory.repository'
import { PurchaseOrderRepository } from '@/repositories/purchase-order.repository'

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

/** Orders that can still take a delivery — the service's RECEIVABLE_STATUSES. */
const RECEIVABLE_PO_STATUSES: POStatus[] = [POStatus.SENT, POStatus.PARTIALLY_RECEIVED]

export type DecideResult =
  | { ok: true; report: { id: string; rrNumber: string } }
  | { ok: false; reason: 'not-pending' }
  | { ok: false; reason: 'not-receivable' | 'over-received'; message: string }

/** Aborts an approval from inside its transaction, rolling everything back. */
class ReceivingConflict extends Error {
  constructor(readonly reason: 'not-receivable' | 'over-received', message: string) {
    super(message)
  }
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

  /** id → rrNumber for a batch of reports, e.g. the ledger's source links. */
  async numbersByIds(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map()
    const rows = await prisma.receivingReport.findMany({ where: { id: { in: ids } }, select: { id: true, rrNumber: true } })
    return new Map(rows.map(row => [row.id, row.rrNumber]))
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

  /**
   * Σ (received − rejected) × unitCost per report — what each would add to
   * stock on approval — for a whole page in one query. Raw SQL because
   * groupBy can only sum a column, not an expression across columns.
   * Postgres numeric comes back as Prisma.Decimal. Reports with no lines are
   * absent.
   */
  async acceptedValues(reportIds: string[]): Promise<Map<string, Prisma.Decimal>> {
    if (reportIds.length === 0) return new Map()

    const rows = await prisma.$queryRaw<{ receivingReportId: string; value: Prisma.Decimal }[]>`
      SELECT "receivingReportId",
             SUM(("receivedQuantity" - "rejectedQuantity") * "unitCost") AS value
      FROM "ReceivingReportItem"
      WHERE "receivingReportId" IN (${Prisma.join(reportIds)})
      GROUP BY "receivingReportId"
    `

    return new Map(rows.map(row => [row.receivingReportId, row.value]))
  },

  async findById(id: string): Promise<ReceivingReportWithDetail | null> {
    return prisma.receivingReport.findUnique({ where: { id }, include: detailInclude })
  },

  /**
   * Accepted quantity (received − rejected) per purchase order line, summed
   * over APPROVED reports only. A draft or pending report has not moved any
   * stock, and a rejected one never will, so neither reduces what is owed.
   *
   * One grouped query for the whole order, rather than one per line. Takes a
   * transaction client when it must read inside one (decide, under the lock).
   */
  async acceptedByLine(
    purchaseOrderId: string,
    db: Prisma.TransactionClient = prisma,
  ): Promise<Map<string, Prisma.Decimal>> {
    const groups = await db.receivingReportItem.groupBy({
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

  /**
   * DRAFT → PENDING_APPROVAL. Returns null if the report stopped being a draft
   * first — see moveStatus. receivedById is left alone: submitting does not
   * make you the person who counted it.
   */
  async submit(id: string): Promise<{ id: string; rrNumber: string } | null> {
    return prisma.$transaction(tx =>
      moveStatus(tx, id, RRStatus.DRAFT, { status: RRStatus.PENDING_APPROVAL }),
    )
  },

  /**
   * PENDING_APPROVAL → APPROVED | REJECTED in one transaction: the status,
   * the Approval row and — on approval — everything the delivery changes:
   *
   *   1. lock the order row, so approvals on one order run one at a time
   *   2. move the report's status (WHERE PENDING_APPROVAL — the race guard)
   *   3. write the Approval row
   *   4. re-check, under the lock, that no order line has now been accepted
   *      beyond what was ordered
   *   5. one IN movement + level increase per line with something accepted
   *   6. the order's status from everything accepted so far
   *
   * Any failure rolls back all of it. A rejection does steps 2–3 only.
   */
  async decide(input: {
    id: string
    approverId: string
    decision: 'APPROVED' | 'REJECTED'
    remarks: string | null
  }): Promise<DecideResult> {
    try {
      return await prisma.$transaction(async tx => {
        const report = await tx.receivingReport.findUniqueOrThrow({
          where:  { id: input.id },
          select: {
            purchaseOrderId: true,
            branchId:        true,
            rrNumber:        true,
            items: {
              select: {
                purchaseOrderItemId: true,
                materialId:          true,
                receivedQuantity:    true,
                rejectedQuantity:    true,
                unitCost:            true,
                material:            { select: { name: true } },
              },
            },
          },
        })
        const approving = input.decision === 'APPROVED'

        // Locked before the report's own row, so every approval takes the two
        // locks in the same order and two of them cannot deadlock.
        const order = approving ? await PurchaseOrderRepository.lockForReceiving(tx, report.purchaseOrderId) : null
        if (approving && (order === null || !RECEIVABLE_PO_STATUSES.includes(order.status))) {
          throw new ReceivingConflict('not-receivable', 'The order can no longer take a delivery')
        }

        const moved = await moveStatus(tx, input.id, RRStatus.PENDING_APPROVAL, {
          status: approving ? RRStatus.APPROVED : RRStatus.REJECTED,
        })
        if (moved === null) return { ok: false as const, reason: 'not-pending' as const }

        await tx.approval.create({
          data: {
            referenceType: 'ReceivingReport',
            referenceId:   input.id,
            approverId:    input.approverId,
            decision:      input.decision,
            remarks:       input.remarks,
          },
        })

        if (!approving || order === null) return { ok: true as const, report: moved }

        // This report is APPROVED inside the transaction now, so the sum
        // includes it: cumulative accepted per order line.
        const accepted = await ReceivingReportRepository.acceptedByLine(report.purchaseOrderId, tx)
        const zero     = new Prisma.Decimal(0)

        for (const item of order.items) {
          if ((accepted.get(item.id) ?? zero).greaterThan(item.quantity)) {
            const name = report.items.find(line => line.purchaseOrderItemId === item.id)?.material.name ?? 'A line'
            throw new ReceivingConflict('over-received', `${name}: approving this would receive more than was ordered`)
          }
        }

        for (const line of report.items) {
          const quantity = line.receivedQuantity.sub(line.rejectedQuantity)
          if (quantity.isZero()) continue

          await InventoryRepository.stockIn(tx, {
            materialId:    line.materialId,
            branchId:      report.branchId,
            quantity,
            unitCost:      line.unitCost,
            referenceType: 'ReceivingReport',
            referenceId:   input.id,
            notes:         report.rrNumber,
          })
        }

        const fullyReceived = order.items.every(item => !(accepted.get(item.id) ?? zero).lessThan(item.quantity))
        const anyReceived   = order.items.some(item => (accepted.get(item.id) ?? zero).greaterThan(0))
        const status =
          fullyReceived ? POStatus.FULLY_RECEIVED
          : anyReceived ? POStatus.PARTIALLY_RECEIVED
          : order.status // nothing accepted yet, e.g. everything rejected: stays SENT
        if (status !== order.status) {
          await PurchaseOrderRepository.setReceivingStatus(tx, report.purchaseOrderId, status)
        }

        return { ok: true as const, report: moved }
      })
    } catch (err) {
      // Thrown inside the callback so Prisma rolls the whole transaction back.
      if (err instanceof ReceivingConflict) return { ok: false, reason: err.reason, message: err.message }
      throw err
    }
  },
}

/**
 * Moves a report from one status to another in a single UPDATE whose WHERE
 * includes the expected current status, the same race guard as
 * PurchaseOrderRepository's moveStatus: of two concurrent transitions, the
 * second matches zero rows and gets null instead of overwriting the first.
 */
async function moveStatus(
  tx: Prisma.TransactionClient,
  id: string,
  from: RRStatus,
  data: Prisma.ReceivingReportUncheckedUpdateManyInput,
): Promise<{ id: string; rrNumber: string } | null> {
  const { count } = await tx.receivingReport.updateMany({ where: { id, status: from }, data })
  if (count === 0) return null

  return tx.receivingReport.findUniqueOrThrow({ where: { id }, select: { id: true, rrNumber: true } })
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
