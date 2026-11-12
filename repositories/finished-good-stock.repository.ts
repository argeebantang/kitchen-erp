import { MovementType, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Finished-goods stock: lots, their levels per branch and their ledger
 * (Week 6 Task 2). The same rules as InventoryRepository for materials: a
 * movement and its level change are written together, on the caller's
 * transaction, so the ledger's SUM(quantity) per lot and branch always equals
 * FinishedGoodLevel.quantity (docs/database.md).
 */

export type ReceiveLotInput = {
  lotNumber: string
  finishedGoodId: string
  /**
   * The document that made it: a production run or a conversion (Week 7
   * Task 1, D8) — exactly one, which a CHECK constraint enforces.
   */
  productionOrderId?: string
  conversionOrderId?: string
  /** Date-only, UTC midnight. */
  producedOn: Date
  /** The run's completion (or the conversion) moment + the finished good's shelf life (Week 6 Task 4). */
  expiresAt: Date
  branchId: string
  quantity: Prisma.Decimal
  /** Cost per unit of the lot — the run's batch cost ÷ its yield (Week 6 Task 3), or a conversion's total cost ÷ its output. */
  unitCost: Prisma.Decimal
  referenceType: string
  referenceId: string
  notes: string | null
}

/** A lot of one finished good with stock at one branch — see lotsOnHand. */
export type LotOnHand = {
  quantity: Prisma.Decimal
  lot: {
    id: string
    lotNumber: string
    expiresAt: Date | null
    movements: { unitCost: Prisma.Decimal | null }[]
  }
}

export type TakeFromLotInput = {
  lotId: string
  branchId: string
  /** Positive: the amount taken. */
  quantity: Prisma.Decimal
  unitCost: Prisma.Decimal | null
  /** OUT (used, e.g. by a conversion) unless given; WASTE for a write-off (Week 7 Task 2). */
  type?: MovementType
  referenceType: string
  referenceId: string
  notes: string | null
}

/**
 * Which lots `required` is taken from, as of `now`: soonest expiry first (the
 * order lotsOnHand returns), never an expired lot — expired food is a
 * write-off, not an ingredient (Week 7 Task 1, D6). A pure function, so the
 * conversion preview and the approval transaction plan with the same rule.
 * `short` > 0 when the unexpired lots do not cover it.
 */
export function planFefoTakes(lots: LotOnHand[], required: Prisma.Decimal, now: Date): {
  takes: { lot: LotOnHand['lot']; quantity: Prisma.Decimal }[]
  short: Prisma.Decimal
} {
  let remaining = required
  const takes: { lot: LotOnHand['lot']; quantity: Prisma.Decimal }[] = []
  for (const level of lots) {
    if (remaining.lessThanOrEqualTo(0)) break
    if (level.lot.expiresAt !== null && level.lot.expiresAt <= now) continue
    const quantity = Prisma.Decimal.min(level.quantity, remaining)
    takes.push({ lot: level.lot, quantity })
    remaining = remaining.sub(quantity)
  }
  return { takes, short: Prisma.Decimal.max(remaining, 0) }
}

export const FinishedGoodStockRepository = {
  /**
   * A new lot comes into stock at one branch: the lot row, one IN movement
   * and its level, on the caller's transaction. The lot is new, so its level
   * row cannot exist yet — a plain create, no upsert. productionOrderId and
   * lotNumber are unique, so a run can only ever produce one lot; a second
   * attempt fails the whole transaction.
   */
  async receiveLot(tx: Prisma.TransactionClient, input: ReceiveLotInput): Promise<{ lotId: string }> {
    const lot = await tx.finishedGoodLot.create({
      data: {
        lotNumber:         input.lotNumber,
        finishedGoodId:    input.finishedGoodId,
        productionOrderId: input.productionOrderId ?? null,
        conversionOrderId: input.conversionOrderId ?? null,
        producedOn:        input.producedOn,
        expiresAt:         input.expiresAt,
      },
      select: { id: true },
    })

    await tx.finishedGoodMovement.create({
      data: {
        lotId:         lot.id,
        branchId:      input.branchId,
        type:          MovementType.IN,
        quantity:      input.quantity,
        unitCost:      input.unitCost,
        referenceType: input.referenceType,
        referenceId:   input.referenceId,
        notes:         input.notes,
      },
    })

    await tx.finishedGoodLevel.create({
      data: { lotId: lot.id, branchId: input.branchId, quantity: input.quantity },
    })

    return { lotId: lot.id }
  },

  /**
   * Lots on hand: every lot-and-branch level that is not zero, soonest expiry
   * first — first to expire, first used (Week 6 Task 4, D5) — and lots with
   * no expiry last; served by @@index([expiresAt]). The Finished Goods page
   * (Week 6 Task 2, D10). Cooked
   * food is perishable, so this stays small; `take` bounds it anyway and the
   * caller asks for one more than it shows to know if it was cut short.
   * A negative level (more went out than came in) is listed: it needs fixing.
   */
  async findLevels(filters: { branchId?: string; take: number }) {
    return prisma.finishedGoodLevel.findMany({
      where: {
        NOT: { quantity: 0 },
        ...(filters.branchId ? { branchId: filters.branchId } : {}),
      },
      include: {
        lot: {
          select: {
            id: true, lotNumber: true, producedOn: true, expiresAt: true, productionOrderId: true, conversionOrderId: true,
            finishedGood: { select: { id: true, code: true, name: true, unit: { select: { abbreviation: true } } } },
            // The lot's first movement is the IN that created it; its unitCost
            // is the lot's cost per unit (Week 6 Task 3).
            movements: { where: { type: MovementType.IN }, orderBy: { createdAt: 'asc' }, take: 1, select: { unitCost: true } },
          },
        },
        branch: { select: { id: true, name: true } },
      },
      orderBy: [{ lot: { expiresAt: { sort: 'asc', nulls: 'last' } } }, { lot: { lotNumber: 'asc' } }],
      take: filters.take,
    })
  },

  /**
   * One finished good's lots with stock at one branch, soonest expiry first
   * (lots with no expiry last), each with its cost per unit — what a
   * conversion takes its source from (Week 7 Task 1, D5–D7). Expired lots are
   * included; the caller decides with one clock what still counts. Small by
   * nature: perishable lots of one good at one branch. Pass `tx` to read
   * inside a transaction, after lockLots.
   */
  async lotsOnHand(
    finishedGoodId: string,
    branchId: string,
    db: Prisma.TransactionClient = prisma,
  ): Promise<LotOnHand[]> {
    return db.finishedGoodLevel.findMany({
      where:  { branchId, quantity: { gt: 0 }, lot: { finishedGoodId } },
      select: {
        quantity: true,
        lot: {
          select: {
            id: true, lotNumber: true, expiresAt: true,
            // The lot's first movement is the IN that created it; its unitCost
            // is the lot's cost per unit (Week 6 Task 3).
            movements: { where: { type: MovementType.IN }, orderBy: { createdAt: 'asc' }, take: 1, select: { unitCost: true } },
          },
        },
      },
      orderBy: [{ lot: { expiresAt: { sort: 'asc', nulls: 'last' } } }, { lot: { lotNumber: 'asc' } }],
    })
  },

  /**
   * One lot at one branch: what it holds there, its good, its expiry and its
   * cost per unit — what a write-off is recorded against (Week 7 Task 2).
   * Null when the lot has never been at that branch.
   */
  async findLotAtBranch(lotId: string, branchId: string) {
    return prisma.finishedGoodLevel.findUnique({
      where:  { lotId_branchId: { lotId, branchId } },
      select: {
        quantity: true,
        branch:   { select: { id: true, name: true } },
        lot: {
          select: {
            id: true, lotNumber: true, producedOn: true, expiresAt: true,
            finishedGood: { select: { id: true, code: true, name: true, unit: { select: { abbreviation: true } } } },
            movements:    { where: { type: MovementType.IN }, orderBy: { createdAt: 'asc' }, take: 1, select: { unitCost: true } },
          },
        },
      },
    })
  },

  /**
   * Every lot with stock at any branch whose expiry is on or before `until` —
   * expired ones included — soonest first, with its good, branch and cost per
   * unit: what the morning expiry check reports (Week 7 Task 3, X3). Served
   * by @@index([expiresAt]); small by nature (perishable, at most 48 h ahead).
   */
  async findExpiringBy(until: Date) {
    return prisma.finishedGoodLevel.findMany({
      where:  { quantity: { gt: 0 }, lot: { expiresAt: { not: null, lte: until } } },
      select: {
        quantity: true,
        branch:   { select: { name: true } },
        lot: {
          select: {
            lotNumber: true, expiresAt: true,
            finishedGood: { select: { name: true, unit: { select: { abbreviation: true } } } },
            movements:    { where: { type: MovementType.IN }, orderBy: { createdAt: 'asc' }, take: 1, select: { unitCost: true } },
          },
        },
      },
      orderBy: [{ lot: { expiresAt: 'asc' } }, { lot: { lotNumber: 'asc' } }],
    })
  },

  /**
   * Locks every level row of one finished good at one branch (SELECT … FOR
   * UPDATE), in id order, for the rest of the caller's transaction — so a
   * second approval taking from the same lots waits, then reads what the
   * first left, and two such transactions cannot deadlock. Read the lots
   * with lotsOnHand(…, tx) afterwards.
   */
  async lockLots(tx: Prisma.TransactionClient, finishedGoodId: string, branchId: string): Promise<void> {
    await tx.$queryRaw`
      SELECT level.id
      FROM "FinishedGoodLevel" AS level
      JOIN "FinishedGoodLot"   AS lot ON lot.id = level."lotId"
      WHERE lot."finishedGoodId" = ${finishedGoodId} AND level."branchId" = ${branchId}
      ORDER BY level.id
      FOR UPDATE OF level
    `
  },

  /**
   * Stock leaving a lot at one branch: one OUT (or WASTE) row with the quantity
   * negated and the level decreased, on the caller's transaction — receiveLot's
   * counterpart. Unlike materials, a lot never goes below zero: you cannot
   * take cooked food that is not there. The decrease only applies while the
   * level covers it; otherwise this throws and the transaction rolls back.
   * Callers lock (lockLots) and plan first, so it does not happen in practice.
   */
  async takeFromLot(tx: Prisma.TransactionClient, input: TakeFromLotInput): Promise<void> {
    const { count } = await tx.finishedGoodLevel.updateMany({
      where: { lotId: input.lotId, branchId: input.branchId, quantity: { gte: input.quantity } },
      data:  { quantity: { decrement: input.quantity } },
    })
    if (count !== 1) {
      throw new Error(`Lot ${input.lotId} at branch ${input.branchId} holds less than ${input.quantity.toString()}`)
    }

    await tx.finishedGoodMovement.create({
      data: {
        lotId:         input.lotId,
        branchId:      input.branchId,
        type:          input.type ?? MovementType.OUT,
        quantity:      input.quantity.negated(),
        unitCost:      input.unitCost,
        referenceType: input.referenceType,
        referenceId:   input.referenceId,
        notes:         input.notes,
      },
    })
  },

  /**
   * InventoryRepository.mismatchedLevels for finished goods: every lot and
   * branch whose level differs from its ledger total, either side missing
   * counting as 0. One statement, one snapshot; for the daily job.
   */
  async mismatchedLevels(): Promise<{
    finishedGoodName: string
    lotNumber: string
    branchName: string
    unitAbbreviation: string
    ledgerTotal: Prisma.Decimal
    stockLevel: Prisma.Decimal
  }[]> {
    return prisma.$queryRaw`
      SELECT good.name AS "finishedGoodName", lot."lotNumber", branch.name AS "branchName",
             unit.abbreviation AS "unitAbbreviation", pairs."ledgerTotal", pairs."stockLevel"
      FROM (
        SELECT COALESCE(level."lotId", ledger."lotId")       AS "lotId",
               COALESCE(level."branchId", ledger."branchId") AS "branchId",
               COALESCE(ledger.total, 0)                     AS "ledgerTotal",
               COALESCE(level.quantity, 0)                   AS "stockLevel"
        FROM "FinishedGoodLevel" AS level
        FULL JOIN (
          SELECT "lotId", "branchId", SUM(quantity) AS total
          FROM "FinishedGoodMovement"
          GROUP BY "lotId", "branchId"
        ) AS ledger ON ledger."lotId" = level."lotId" AND ledger."branchId" = level."branchId"
        WHERE COALESCE(ledger.total, 0) <> COALESCE(level.quantity, 0)
      ) AS pairs
      JOIN "FinishedGoodLot" AS lot    ON lot.id = pairs."lotId"
      JOIN "FinishedGood"    AS good   ON good.id = lot."finishedGoodId"
      JOIN "Unit"            AS unit   ON unit.id = good."unitId"
      JOIN "Branch"          AS branch ON branch.id = pairs."branchId"
      ORDER BY branch.name, lot."lotNumber"
    `
  },

  /**
   * The finished-goods movements one source document wrote, oldest first,
   * with their lot and branch. Served by @@index([referenceType, referenceId]).
   */
  async findMovementsByReference(referenceType: string, referenceId: string) {
    return prisma.finishedGoodMovement.findMany({
      where:   { referenceType, referenceId },
      include: {
        lot:    { select: { lotNumber: true, producedOn: true, expiresAt: true, finishedGood: { select: { name: true, unit: { select: { abbreviation: true } } } } } },
        branch: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
  },
}
