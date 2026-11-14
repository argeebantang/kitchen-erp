import { MovementType, Prisma, TransferStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { FinishedGoodStockRepository, planFefoTakes } from '@/repositories/finished-good-stock.repository'

/**
 * Transfer Orders (Week 8 Task 2): finished goods sent from a commissary to
 * another branch. Stock moves only from Task 3 (dispatch on approval,
 * arrival on receipt), through FinishedGoodStockRepository.
 */

const stockTransferInclude = {
  fromBranch:  { select: { id: true, name: true, code: true } },
  toBranch:    { select: { id: true, name: true, code: true } },
  submittedBy: { select: { id: true, name: true } },
  receivedBy:  { select: { id: true, name: true } },
  items: {
    include: {
      finishedGood: { select: { id: true, code: true, name: true, unit: { select: { abbreviation: true } } } },
    },
    orderBy: { finishedGood: { name: 'asc' } },
  },
} satisfies Prisma.StockTransferInclude

export type StockTransferWithDetail = Prisma.StockTransferGetPayload<{ include: typeof stockTransferInclude }>

export type StockTransferDecideResult =
  | { ok: true }
  | { ok: false; reason: 'not-pending' }
  | { ok: false; reason: 'stock'; message: string }

/** Thrown inside the decide transaction so Prisma rolls all of it back. */
class StockTransferConflict extends Error {}

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

  /**
   * Accounting's decision, in one transaction (Week 8 Task 3, R1). The status
   * moves first, with PENDING_APPROVAL in the WHERE (0 rows → someone decided
   * it first, nothing written), then the Approval row. Rejecting stops there.
   *
   * Approving is the dispatch. For each line, goods in id order — so two
   * approvals locking several goods take them in the same order and cannot
   * deadlock; conversions and write-offs lock one good, by the same lockLots
   * — it locks the good's lot levels at the sender, re-reads them, and plans
   * soonest expiry first as of now, expired lots skipped (planFefoTakes, the
   * rule the form showed). Any line short refuses the whole approval
   * ('stock', every short line named). Otherwise each lot taken leaves as
   * one TRANSFER (−) movement at the lot's recorded cost; the receiver gets
   * the same lots on receipt.
   */
  async decide(input: {
    id: string
    approverId: string
    remarks: string | null
    decision:
      | { kind: 'REJECTED' }
      | {
          kind: 'APPROVED'
          transferNumber: string
          fromBranchId: string
          fromBranchName: string
          lines: { finishedGoodId: string; name: string; unitAbbreviation: string; quantity: Prisma.Decimal }[]
        }
  }): Promise<StockTransferDecideResult> {
    try {
      return await prisma.$transaction(async tx => {
        const approving = input.decision.kind === 'APPROVED'
        const { count } = await tx.stockTransfer.updateMany({
          where: { id: input.id, status: TransferStatus.PENDING_APPROVAL },
          data:  { status: approving ? TransferStatus.APPROVED : TransferStatus.REJECTED },
        })
        if (count === 0) return { ok: false as const, reason: 'not-pending' as const }

        await tx.approval.create({
          data: {
            referenceType: 'StockTransfer',
            referenceId:   input.id,
            approverId:    input.approverId,
            decision:      input.decision.kind,
            remarks:       input.remarks,
          },
        })

        if (input.decision.kind === 'REJECTED') return { ok: true as const }
        const approved = input.decision

        const now   = new Date()
        const lines = [...approved.lines].sort((a, b) => a.finishedGoodId.localeCompare(b.finishedGoodId))
        const plans = []
        const shortfalls: string[] = []
        for (const line of lines) {
          await FinishedGoodStockRepository.lockLots(tx, line.finishedGoodId, approved.fromBranchId)
          const lots = await FinishedGoodStockRepository.lotsOnHand(line.finishedGoodId, approved.fromBranchId, tx)
          const plan = planFefoTakes(lots, line.quantity, now)
          if (plan.short.greaterThan(0)) {
            shortfalls.push(`${line.name} — ${line.quantity.toString()} ${line.unitAbbreviation} to send, ${line.quantity.sub(plan.short).toString()} ${line.unitAbbreviation} unexpired on hand`)
          }
          plans.push(plan)
        }
        if (shortfalls.length > 0) {
          throw new StockTransferConflict(
            `${approved.fromBranchName} no longer has enough: ${shortfalls.join('; ')}. `
            + 'Since this was recorded it was used, converted, written off, sent elsewhere or has expired — reject it, and production records what can be sent',
          )
        }

        for (const plan of plans) {
          for (const take of plan.takes) {
            await FinishedGoodStockRepository.takeFromLot(tx, {
              lotId:         take.lot.id,
              branchId:      approved.fromBranchId,
              quantity:      take.quantity,
              unitCost:      take.lot.movements[0]?.unitCost ?? null,
              type:          MovementType.TRANSFER,
              referenceType: 'StockTransfer',
              referenceId:   input.id,
              notes:         approved.transferNumber,
            })
          }
        }
        return { ok: true as const }
      })
    } catch (err) {
      if (err instanceof StockTransferConflict) return { ok: false, reason: 'stock', message: err.message }
      throw err
    }
  },

  /**
   * The receiving branch confirms the goods arrived (Week 8 Task 3, R3), in
   * one transaction: APPROVED → RECEIVED with who and when, the status in the
   * WHERE (0 rows → not in transit: already received, or never dispatched).
   * Then every lot that left the sender — read back from this transfer's own
   * TRANSFER (−) rows, so what arrives is exactly what was dispatched —
   * arrives into the same lot at the receiver as TRANSFER (+), keeping its
   * number, expiry and cost (R6: an expired lot arrives too, flagged there).
   * Lots in id order, so two receipts at one branch cannot deadlock.
   * All of it, for now (R4); partial receipt and variance are Task 4.
   */
  async receive(input: {
    id: string
    receiverId: string
    toBranchId: string
    transferNumber: string
  }): Promise<{ ok: true } | { ok: false; reason: 'not-in-transit' }> {
    return prisma.$transaction(async tx => {
      const { count } = await tx.stockTransfer.updateMany({
        where: { id: input.id, status: TransferStatus.APPROVED },
        data:  { status: TransferStatus.RECEIVED, receivedById: input.receiverId, receivedAt: new Date() },
      })
      if (count === 0) return { ok: false as const, reason: 'not-in-transit' as const }

      const dispatched = (await FinishedGoodStockRepository.findMovementsByReference('StockTransfer', input.id, tx))
        .filter(movement => movement.quantity.lessThan(0))
        .sort((a, b) => a.lotId.localeCompare(b.lotId))
      for (const movement of dispatched) {
        await FinishedGoodStockRepository.transferIntoLot(tx, {
          lotId:         movement.lotId,
          branchId:      input.toBranchId,
          quantity:      movement.quantity.abs(),
          unitCost:      movement.unitCost,
          referenceType: 'StockTransfer',
          referenceId:   input.id,
          notes:         input.transferNumber,
        })
      }
      return { ok: true as const }
    })
  },

  /** Pending transfers, oldest first — the approvals inbox. Bounded by `take`. */
  async findPending(take: number): Promise<StockTransferWithDetail[]> {
    return prisma.stockTransfer.findMany({
      where:   { status: TransferStatus.PENDING_APPROVAL },
      include: stockTransferInclude,
      orderBy: { createdAt: 'asc' },
      take,
    })
  },

  async numbersByIds(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map()
    const rows = await prisma.stockTransfer.findMany({ where: { id: { in: ids } }, select: { id: true, transferNumber: true } })
    return new Map(rows.map(row => [row.id, row.transferNumber]))
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
