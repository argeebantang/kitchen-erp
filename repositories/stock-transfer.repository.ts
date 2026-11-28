import { MovementType, Prisma, TransferKind, TransferStatus, TransferVarianceReason } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { FinishedGoodStockRepository, planFefoTakes, withoutClaims } from '@/repositories/finished-good-stock.repository'
import { WriteOffRepository } from '@/repositories/write-off.repository'
import { containsText, type ListSort } from '@/lib/list-query'

/**
 * Transfer Orders (Week 8 Task 2): finished goods sent from a commissary to
 * another branch. Stock moves only from Task 3 (dispatch on approval,
 * arrival on receipt), through FinishedGoodStockRepository. Returns (Week 9
 * Task 9) are transfers of kind RETURN, from an outlet back to a kitchen:
 * dispatched when recorded (createReturn), received like any other.
 */

const stockTransferInclude = {
  fromBranch:  { select: { id: true, name: true, code: true } },
  toBranch:    { select: { id: true, name: true, code: true } },
  submittedBy: { select: { id: true, name: true } },
  receivedBy:  { select: { id: true, name: true } },
  stockRequest: { select: { id: true, requestNumber: true } },
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
  /** The stock request this delivery fills (Week 9 Task 10); checked by the service. */
  stockRequestId?: string | null
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
  /** Only those received short — a reason is recorded exactly then (Task 4, V4). */
  shortOnly?: boolean
  skip?: number
  take?: number
  /** The list page's search box. */
  search?: string
  /** The list page's column sort (Week 12). */
  listSort?: ListSort<StockTransferSortKey>
}

/** Columns the Transfers list can sort by (Week 12). */
export const STOCK_TRANSFER_SORT_KEYS = ['number', 'from', 'to', 'recorded', 'status'] as const
export type StockTransferSortKey = typeof STOCK_TRANSFER_SORT_KEYS[number]

// createdAt / id break ties, so a page boundary never shows a row twice or skips one.
function listOrderBy({ key, dir }: ListSort<StockTransferSortKey>): Prisma.StockTransferOrderByWithRelationInput[] {
  const tieBreak: Prisma.StockTransferOrderByWithRelationInput[] = [{ createdAt: 'desc' }, { id: 'desc' }]
  switch (key) {
    case 'number': return [{ transferNumber: dir }]
    case 'from': return [{ fromBranch: { name: dir } }, ...tieBreak]
    case 'to': return [{ toBranch: { name: dir } }, ...tieBreak]
    case 'recorded': return [{ createdAt: dir }, { id: dir }]
    case 'status': return [{ status: dir }, ...tieBreak]
  }
}

/** What dispatching takes: the transfer and, per line, what leaves the sender. */
type DispatchInput = {
  id: string
  transferNumber: string
  fromBranchId: string
  fromBranchName: string
  lines: { finishedGoodId: string; name: string; unitAbbreviation: string; quantity: Prisma.Decimal }[]
}

/**
 * Sends a transfer's lines out of the sender, on the caller's transaction —
 * a delivery when accounting approves it, a return when it is recorded. For
 * each line, goods in id order — so two dispatches locking several goods take
 * them in the same order and cannot deadlock; conversions and write-offs lock
 * one good, by the same lockLots — it locks the good's lot levels at the
 * sender, re-reads them, and plans soonest expiry first as of now, expired
 * lots skipped (planFefoTakes, the rule the form showed). Any line short
 * throws StockTransferConflict (every short line named), so the caller's
 * transaction rolls back whole. Otherwise each lot taken leaves as one
 * TRANSFER (−) movement at the lot's recorded cost; the receiver gets the
 * same lots on receipt.
 */
async function dispatch(tx: Prisma.TransactionClient, input: DispatchInput, shortHint: string): Promise<void> {
  const now   = new Date()
  const lines = [...input.lines].sort((a, b) => a.finishedGoodId.localeCompare(b.finishedGoodId))
  const plans = []
  const shortfalls: string[] = []
  for (const line of lines) {
    await FinishedGoodStockRepository.lockLots(tx, line.finishedGoodId, input.fromBranchId)
    // Never a lot's kilos a pending write-off claims: spoiled food is not sent out (2026-11-28).
    const lots = withoutClaims(
      await FinishedGoodStockRepository.lotsOnHand(line.finishedGoodId, input.fromBranchId, tx),
      await WriteOffRepository.pendingClaimsByLot(line.finishedGoodId, input.fromBranchId, tx),
    )
    const plan = planFefoTakes(lots, line.quantity, now)
    if (plan.short.greaterThan(0)) {
      shortfalls.push(`${line.name} — ${line.quantity.toString()} ${line.unitAbbreviation} to send, ${line.quantity.sub(plan.short).toString()} ${line.unitAbbreviation} unexpired on hand and not claimed by a pending write-off`)
    }
    plans.push(plan)
  }
  if (shortfalls.length > 0) {
    throw new StockTransferConflict(`${input.fromBranchName} no longer has enough: ${shortfalls.join('; ')}. ${shortHint}`)
  }

  for (const plan of plans) {
    for (const take of plan.takes) {
      await FinishedGoodStockRepository.takeFromLot(tx, {
        lotId:         take.lot.id,
        branchId:      input.fromBranchId,
        quantity:      take.quantity,
        unitCost:      take.lot.movements[0]?.unitCost ?? null,
        type:          MovementType.TRANSFER,
        referenceType: 'StockTransfer',
        referenceId:   input.id,
        notes:         input.transferNumber,
      })
    }
  }
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
          kind:          TransferKind.DELIVERY,
          status:        TransferStatus.PENDING_APPROVAL,
          stockRequestId: input.stockRequestId ?? null,
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
   * Records a return and dispatches it, in one transaction (Week 9 Task 9):
   * numbered RTN-000001 from rtn_number_seq, created APPROVED — in transit;
   * there is no approval — and its lines leave the outlet through dispatch(),
   * the same lot rule as a delivery's approval. Short → nothing is written,
   * { ok: false } with every short line named.
   */
  async createReturn(input: CreateStockTransferInput & {
    fromBranchName: string
    lines: { finishedGoodId: string; name: string; unitAbbreviation: string; quantity: Prisma.Decimal }[]
  }): Promise<{ ok: true; id: string; transferNumber: string } | { ok: false; message: string }> {
    try {
      return await prisma.$transaction(async tx => {
        const [row] = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('rtn_number_seq')`
        const transferNumber = `RTN-${row.nextval.toString().padStart(6, '0')}`

        const created = await tx.stockTransfer.create({
          data: {
            transferNumber,
            kind:          TransferKind.RETURN,
            status:        TransferStatus.APPROVED,
            fromBranchId:  input.fromBranchId,
            toBranchId:    input.toBranchId,
            submittedById: input.submittedById,
            notes:         input.notes,
            items:         { create: input.items },
          },
          select: { id: true, transferNumber: true },
        })
        await dispatch(tx, {
          id:             created.id,
          transferNumber: created.transferNumber,
          fromBranchId:   input.fromBranchId,
          fromBranchName: input.fromBranchName,
          lines:          input.lines,
        }, 'Since the form was opened it was sold, written off or has expired — reload and send what is on hand')
        return { ok: true as const, ...created }
      })
    } catch (err) {
      if (err instanceof StockTransferConflict) return { ok: false, message: err.message }
      throw err
    }
  },

  /**
   * Accounting's decision, in one transaction (Week 8 Task 3, R1). The status
   * moves first, with PENDING_APPROVAL in the WHERE (0 rows → someone decided
   * it first, nothing written), then the Approval row. Rejecting stops there.
   *
   * Approving is the dispatch (dispatch(), shared with returns). Any line
   * short refuses the whole approval ('stock', every short line named).
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

        await dispatch(tx, { id: input.id, ...approved }, 'Since this was recorded it was used, converted, written off, sent elsewhere or has expired — reject it, and production records what can be sent')
        return { ok: true as const }
      })
    } catch (err) {
      if (err instanceof StockTransferConflict) return { ok: false, reason: 'stock', message: err.message }
      throw err
    }
  },

  /**
   * The receiving branch confirms what arrived (Week 8 Task 3, R3; Task 4),
   * in one transaction. The lots that left the sender are read back from this
   * transfer's own TRANSFER (−) rows — one per lot, since a lot belongs to one
   * good and a good to one line — and `received` says how much of each
   * arrived (the service has checked every lot is counted, 0 ≤ count ≤ sent).
   * Then APPROVED → RECEIVED with who, when and the variance, the status in
   * the WHERE (0 rows → not in transit: already received, or never
   * dispatched). What arrived joins the same lot at the receiver as
   * TRANSFER (+), keeping its number, expiry and cost (R6: an expired lot
   * arrives too, flagged there); a lot counted 0 gets no row. The shortfall
   * gets no movement — it was lost on the road, not at either branch (V3) —
   * and is valued at each lot's cost: 0 when everything arrived, null when a
   * short lot has no cost. Lots in id order, so two receipts at one branch
   * cannot deadlock.
   */
  async receive(input: {
    id: string
    receiverId: string
    toBranchId: string
    transferNumber: string
    /** Lot id → quantity that arrived. */
    received: Map<string, Prisma.Decimal>
    varianceReason: TransferVarianceReason | null
    varianceNotes: string | null
  }): Promise<{ ok: true; varianceValue: Prisma.Decimal | null } | { ok: false; reason: 'not-in-transit' }> {
    return prisma.$transaction(async tx => {
      const dispatched = (await FinishedGoodStockRepository.findMovementsByReference('StockTransfer', input.id, tx))
        .filter(movement => movement.quantity.lessThan(0))
        .sort((a, b) => a.lotId.localeCompare(b.lotId))

      const arrivals: { lotId: string; quantity: Prisma.Decimal; unitCost: Prisma.Decimal | null }[] = []
      let varianceValue: Prisma.Decimal | null = new Prisma.Decimal(0)
      for (const movement of dispatched) {
        const sent    = movement.quantity.abs()
        const arrived = input.received.get(movement.lotId)
        // The service validated against these same rows; a gap here is a bug, so roll back.
        if (arrived === undefined || arrived.lessThan(0) || arrived.greaterThan(sent)) {
          throw new Error(`Receipt count for lot ${movement.lotId} on ${input.transferNumber} is missing or out of range`)
        }
        const short = sent.sub(arrived)
        if (short.greaterThan(0)) {
          varianceValue = varianceValue === null || movement.unitCost === null ? null : varianceValue.add(short.mul(movement.unitCost))
        }
        if (arrived.greaterThan(0)) arrivals.push({ lotId: movement.lotId, quantity: arrived, unitCost: movement.unitCost })
      }

      const { count } = await tx.stockTransfer.updateMany({
        where: { id: input.id, status: TransferStatus.APPROVED },
        data:  {
          status:         TransferStatus.RECEIVED,
          receivedById:   input.receiverId,
          receivedAt:     new Date(),
          varianceValue,
          varianceReason: input.varianceReason,
          varianceNotes:  input.varianceNotes,
        },
      })
      if (count === 0) return { ok: false as const, reason: 'not-in-transit' as const }

      for (const arrival of arrivals) {
        await FinishedGoodStockRepository.transferIntoLot(tx, {
          lotId:         arrival.lotId,
          branchId:      input.toBranchId,
          quantity:      arrival.quantity,
          unitCost:      arrival.unitCost,
          referenceType: 'StockTransfer',
          referenceId:   input.id,
          notes:         input.transferNumber,
        })
      }
      return { ok: true as const, varianceValue }
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

  /**
   * A branch's open transfers, oldest first (Week 8 Task 5): in transit to it,
   * and awaiting approval from or to it. Bounded by `take` per kind.
   */
  async findOpenForBranch(branchId: string, take: number): Promise<{
    arriving: StockTransferWithDetail[]
    pending: StockTransferWithDetail[]
  }> {
    const [arriving, pending] = await prisma.$transaction([
      prisma.stockTransfer.findMany({
        where:   { status: TransferStatus.APPROVED, toBranchId: branchId },
        include: stockTransferInclude,
        orderBy: { createdAt: 'asc' },
        take,
      }),
      prisma.stockTransfer.findMany({
        where:   { status: TransferStatus.PENDING_APPROVAL, OR: [{ fromBranchId: branchId }, { toBranchId: branchId }] },
        include: stockTransferInclude,
        orderBy: { createdAt: 'asc' },
        take,
      }),
    ])
    return { arriving, pending }
  },

  /**
   * In transit (APPROVED), oldest first — the Receive screen (Week 12). The
   * service narrows it to what the viewer may receive: one branch's
   * deliveries and returns (`toBranchId`), or returns only (`kind`), or all.
   * `search` matches the transfer number only — the screen asks for one.
   */
  async findInTransit(filters: { toBranchId?: string; kind?: TransferKind; search?: string }, take: number) {
    return prisma.stockTransfer.findMany({
      where: {
        status:         TransferStatus.APPROVED,
        toBranchId:     filters.toBranchId,
        kind:           filters.kind,
        transferNumber: filters.search ? containsText(filters.search) : undefined,
      },
      include: stockTransferInclude,
      orderBy: { createdAt: 'asc' },
      take,
    })
  },

  /** In transit (APPROVED, not yet received), per receiving branch — Branch Inventory's "arriving" (Week 8 Task 5). */
  async inTransitCountByBranch(): Promise<Map<string, number>> {
    const rows = await prisma.stockTransfer.groupBy({
      by:     ['toBranchId'],
      where:  { status: TransferStatus.APPROVED },
      _count: { _all: true },
    })
    return new Map(rows.map(row => [row.toBranchId, row._count._all]))
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
    if (filters.shortOnly) where.varianceReason = { not: null }
    if (filters.search) {
      const text = containsText(filters.search)
      // AND, not OR at the top: the branch filter above already uses where.OR.
      where.AND = [{ OR: [{ transferNumber: text }, { fromBranch: { name: text } }, { toBranch: { name: text } }, { stockRequest: { requestNumber: text } }, { items: { some: { finishedGood: { name: text } } } }] }]
    }
    const short: Prisma.StockTransferWhereInput = { AND: [where, { varianceReason: { not: null } }] }

    const [rows, total, lost] = await prisma.$transaction([
      prisma.stockTransfer.findMany({
        where,
        include: stockTransferInclude,
        orderBy: filters.listSort ? listOrderBy(filters.listSort) : { createdAt: 'desc' },
        skip:    filters.skip ?? 0,
        take:    filters.take ?? 50,
      }),
      prisma.stockTransfer.count({ where }),
      // _count.varianceValue counts non-null values: the rest had a lot with no cost.
      prisma.stockTransfer.aggregate({ where: short, _sum: { varianceValue: true }, _count: { _all: true, varianceValue: true } }),
    ])
    return {
      rows,
      total,
      lost: {
        count:    lost._count._all,
        value:    lost._sum.varianceValue ?? new Prisma.Decimal(0),
        unvalued: lost._count._all - lost._count.varianceValue,
      },
    }
  },

  /**
   * Transfers received short in [start, end) — the costing dashboard's
   * transfer shortfall, on the day it was received (Week 8 Task 6, C4, C11).
   * A null varianceValue is a shortfall from a lot with no cost.
   */
  async findReceivedShortBetween(start: Date, end: Date) {
    return prisma.stockTransfer.findMany({
      where:  { status: TransferStatus.RECEIVED, varianceReason: { not: null }, receivedAt: { gte: start, lt: end } },
      select: { varianceValue: true, receivedAt: true },
    })
  },
}
