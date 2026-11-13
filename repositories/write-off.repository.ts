import { MovementType, Prisma, WriteOffReason, WriteOffStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { FinishedGoodStockRepository } from '@/repositories/finished-good-stock.repository'

export type CreateWriteOffInput = {
  lotId: string
  branchId: string
  submittedById: string
  quantity: Prisma.Decimal
  reason: WriteOffReason
  notes: string | null
}

export type WriteOffDecideResult =
  | { ok: true }
  | { ok: false; reason: 'not-pending' }
  | { ok: false; reason: 'stock'; message: string }

/** Aborts an approval from inside its transaction, rolling everything back. */
class WriteOffConflict extends Error {}

export type WriteOffListFilters = {
  status?: WriteOffStatus
  reason?: WriteOffReason
  skip?: number
  take?: number
}

/**
 * Everything a list row and the detail page show, in one query: the lot with
 * its good, where it came from and its cost per unit (the IN movement that
 * created it, Week 6 Task 3), the branch and who recorded it.
 */
const writeOffInclude = {
  lot: {
    select: {
      id: true, lotNumber: true, producedOn: true, expiresAt: true, productionOrderId: true, conversionOrderId: true,
      finishedGood: { select: { id: true, code: true, name: true, unit: { select: { abbreviation: true } } } },
      movements:    { where: { type: 'IN' as const }, orderBy: { createdAt: 'asc' as const }, take: 1, select: { unitCost: true } },
    },
  },
  branch:      { select: { id: true, name: true } },
  submittedBy: { select: { id: true, name: true } },
} as const

export type WriteOffWithDetail = Prisma.WriteOffGetPayload<{ include: typeof writeOffInclude }>

export const WriteOffRepository = {
  /**
   * Inserts a write-off numbered WO-000001 from wo_number_seq, already
   * PENDING_APPROVAL: recording it submits it (Week 7 Task 2, W4). nextval()
   * runs inside the same transaction as the insert, like every other
   * document number.
   */
  async create(input: CreateWriteOffInput): Promise<{ id: string; writeOffNumber: string }> {
    return prisma.$transaction(async tx => {
      const [row] = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('wo_number_seq')`
      const writeOffNumber = `WO-${row.nextval.toString().padStart(6, '0')}`

      return tx.writeOff.create({
        data:   { ...input, writeOffNumber, status: WriteOffStatus.PENDING_APPROVAL },
        select: { id: true, writeOffNumber: true },
      })
    })
  },

  async numbersByIds(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map()
    const rows = await prisma.writeOff.findMany({ where: { id: { in: ids } }, select: { id: true, writeOffNumber: true } })
    return new Map(rows.map(row => [row.id, row.writeOffNumber]))
  },

  async findById(id: string): Promise<WriteOffWithDetail | null> {
    return prisma.writeOff.findUnique({ where: { id }, include: writeOffInclude })
  },

  /**
   * Newest first, paged, optionally one status and/or reason — with the peso
   * value of the APPROVED write-offs among everything the filters match (not
   * just this page): what was actually lost, the Week 7 deliverable's "peso
   * value impact". One snapshot.
   */
  async findMany(filters: WriteOffListFilters = {}) {
    const where: Prisma.WriteOffWhereInput = {}
    if (filters.status) where.status = filters.status
    if (filters.reason) where.reason = filters.reason

    const [rows, total, approved] = await prisma.$transaction([
      prisma.writeOff.findMany({
        where,
        include: writeOffInclude,
        orderBy: { createdAt: 'desc' },
        skip:    filters.skip ?? 0,
        take:    filters.take ?? 50,
      }),
      prisma.writeOff.count({ where }),
      prisma.writeOff.aggregate({
        where: { AND: [where, { status: WriteOffStatus.APPROVED }] },
        _sum:  { totalCost: true },
      }),
    ])

    return { rows, total, approvedValue: approved._sum.totalCost ?? new Prisma.Decimal(0) }
  },

  /**
   * Accounting's decision, in one transaction (Week 7 Task 2, W4). The status
   * moves first, with PENDING_APPROVAL in the WHERE (0 rows → someone decided
   * it first, nothing written), then the Approval row. Rejecting stops there.
   *
   * Approving then, on the same transaction: locks the finished good's lot
   * levels at the branch (lockLots — the same lock, in the same order, a
   * conversion takes, so the two cannot deadlock), re-reads the lot and
   * refuses ('stock') if it no longer holds the quantity — it may have been
   * converted or written off since; takes the quantity out as one WASTE
   * movement at the lot's recorded cost per unit; and records unitCost and
   * totalCost on the write-off (W6), never recomputed.
   */
  async decide(input: {
    id: string
    approverId: string
    remarks: string | null
    decision:
      | { kind: 'REJECTED' }
      | {
          kind: 'APPROVED'
          writeOffNumber: string
          lotId: string
          lotNumber: string
          finishedGoodId: string
          branchId: string
          quantity: Prisma.Decimal
          unitAbbreviation: string
        }
  }): Promise<WriteOffDecideResult> {
    try {
      return await prisma.$transaction(async tx => {
        const approving = input.decision.kind === 'APPROVED'
        const { count } = await tx.writeOff.updateMany({
          where: { id: input.id, status: WriteOffStatus.PENDING_APPROVAL },
          data:  { status: approving ? WriteOffStatus.APPROVED : WriteOffStatus.REJECTED },
        })
        if (count === 0) return { ok: false as const, reason: 'not-pending' as const }

        await tx.approval.create({
          data: {
            referenceType: 'WriteOff',
            referenceId:   input.id,
            approverId:    input.approverId,
            decision:      input.decision.kind,
            remarks:       input.remarks,
          },
        })

        if (input.decision.kind === 'REJECTED') return { ok: true as const }
        const approved = input.decision

        await FinishedGoodStockRepository.lockLots(tx, approved.finishedGoodId, approved.branchId)
        const lots = await FinishedGoodStockRepository.lotsOnHand(approved.finishedGoodId, approved.branchId, tx)
        const level = lots.find(candidate => candidate.lot.id === approved.lotId)
        const onHand = level?.quantity ?? new Prisma.Decimal(0)
        if (onHand.lessThan(approved.quantity)) {
          throw new WriteOffConflict(`Lot ${approved.lotNumber} holds only ${onHand.toString()} ${approved.unitAbbreviation} now — less than the ${approved.quantity.toString()} ${approved.unitAbbreviation} to write off. It was used or written off since this was recorded; reject it, and production records what is left`)
        }
        const unitCost = level?.lot.movements[0]?.unitCost ?? null
        if (unitCost === null) {
          throw new WriteOffConflict(`Lot ${approved.lotNumber} has no recorded cost, so the write-off cannot be costed`)
        }

        await FinishedGoodStockRepository.takeFromLot(tx, {
          lotId:         approved.lotId,
          branchId:      approved.branchId,
          quantity:      approved.quantity,
          unitCost,
          type:          MovementType.WASTE,
          referenceType: 'WriteOff',
          referenceId:   input.id,
          notes:         approved.writeOffNumber,
        })

        await tx.writeOff.update({
          where: { id: input.id },
          data:  { unitCost, totalCost: approved.quantity.mul(unitCost) },
        })
        return { ok: true as const }
      })
    } catch (err) {
      // Thrown inside the callback so Prisma rolls the whole transaction back.
      if (err instanceof WriteOffConflict) return { ok: false, reason: 'stock', message: err.message }
      throw err
    }
  },

  /** Pending write-offs, oldest first — the approvals inbox. Bounded by `take`. */
  async findPending(take: number): Promise<WriteOffWithDetail[]> {
    return prisma.writeOff.findMany({
      where:   { status: WriteOffStatus.PENDING_APPROVAL },
      include: writeOffInclude,
      orderBy: { createdAt: 'asc' },
      take,
    })
  },

  /**
   * Every lot and branch with write-offs awaiting approval, and how much they
   * claim — one grouped query for the Finished Goods page (W8). Pending
   * write-offs are few at any time, so this is not bounded.
   */
  async pendingByLot(): Promise<{ lotId: string; branchId: string; quantity: Prisma.Decimal }[]> {
    const groups = await prisma.writeOff.groupBy({
      by:    ['lotId', 'branchId'],
      where: { status: WriteOffStatus.PENDING_APPROVAL },
      _sum:  { quantity: true },
    })
    return groups.map(group => ({ lotId: group.lotId, branchId: group.branchId, quantity: group._sum.quantity ?? new Prisma.Decimal(0) }))
  },

  /**
   * How much of one lot at one branch other write-offs have claimed but not
   * yet taken (W5). Served by @@index([lotId, status]).
   */
  async pendingOnLot(lotId: string, branchId: string, excludeId: string | null): Promise<Prisma.Decimal> {
    const { _sum } = await prisma.writeOff.aggregate({
      where: {
        status: WriteOffStatus.PENDING_APPROVAL,
        lotId,
        branchId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      _sum: { quantity: true },
    })
    return _sum.quantity ?? new Prisma.Decimal(0)
  },

  /**
   * How much of one finished good's UNEXPIRED lots at a branch pending
   * write-offs have claimed — what a conversion cannot count as available
   * (W5). Expired lots are left out: conversions never take them anyway.
   */
  async pendingOnUnexpiredLots(finishedGoodId: string, branchId: string, now: Date): Promise<Prisma.Decimal> {
    const { _sum } = await prisma.writeOff.aggregate({
      where: {
        status: WriteOffStatus.PENDING_APPROVAL,
        branchId,
        lot: { finishedGoodId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      },
      _sum: { quantity: true },
    })
    return _sum.quantity ?? new Prisma.Decimal(0)
  },
}
