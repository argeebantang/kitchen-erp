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

/** A named end-of-day flow (Week 7 Task 4, E1). */
export type DayFlow = 'produced' | 'convertedIn' | 'convertedOut' | 'writtenOff' | 'distributed'

/**
 * Which ledger movements make each end-of-day flow — the one place this is
 * decided, used by dayFlows and dayDocuments alike. A movement matching none
 * of them is "other", which the End of Day page reports as unrecognised.
 */
const DAY_FLOWS: [DayFlow, Prisma.Sql][] = [
  ['produced',     Prisma.sql`m.type = 'IN' AND m."referenceType" = 'ProductionOrder'`],
  ['convertedIn',  Prisma.sql`m.type = 'IN' AND m."referenceType" = 'ConversionOrder'`],
  ['convertedOut', Prisma.sql`m.type = 'OUT' AND m."referenceType" = 'ConversionOrder'`],
  ['writtenOff',   Prisma.sql`m.type = 'WASTE' AND m."referenceType" = 'WriteOff'`],
  // Transfers between branches arrive with Week 8.
  ['distributed',  Prisma.sql`m.type = 'TRANSFER'`],
]
const KNOWN_FLOW = Prisma.sql`(${Prisma.join(DAY_FLOWS.map(([, condition]) => Prisma.sql`(${condition})`), ' OR ')})`

/**
 * c.cost: the cost per unit of movement m's lot — its first IN's unitCost
 * (Week 6 Task 3) — for joining after "FinishedGoodLot" AS lot.
 */
const LOT_COST = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT first_in."unitCost" AS cost FROM "FinishedGoodMovement" AS first_in
    WHERE first_in."lotId" = lot.id AND first_in.type = 'IN'
    ORDER BY first_in."createdAt" LIMIT 1
  ) AS c ON true`

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
   * One business day of finished goods, per finished good and branch, from
   * the ledger alone (Week 7 Task 4, E1): the balance before `start`, each
   * flow within [start, end) by where it came from, and the balance before
   * `end`. One statement, one snapshot, so opening + flows = closing unless a
   * movement fits none of the flows — which lands in `other`, not nowhere.
   *
   * Values are each movement's quantity × its lot's recorded cost per unit
   * (the IN that created the lot, Week 6 Task 3), the same yardstick for
   * every figure, so the pesos add up like the kilos. A pair with nothing at
   * all before `end` is left out.
   */
  async dayFlows(start: Date, end: Date, branchId: string | null): Promise<{
    finishedGoodId: string; finishedGoodCode: string; finishedGoodName: string; unitAbbreviation: string
    branchId: string; branchName: string
    openingQty: Prisma.Decimal | null; openingValue: Prisma.Decimal | null
    producedQty: Prisma.Decimal | null; producedValue: Prisma.Decimal | null
    convertedInQty: Prisma.Decimal | null; convertedInValue: Prisma.Decimal | null
    convertedOutQty: Prisma.Decimal | null; convertedOutValue: Prisma.Decimal | null
    writtenOffQty: Prisma.Decimal | null; writtenOffValue: Prisma.Decimal | null
    distributedQty: Prisma.Decimal | null; distributedValue: Prisma.Decimal | null
    otherQty: Prisma.Decimal | null; otherValue: Prisma.Decimal | null
    closingQty: Prisma.Decimal | null; closingValue: Prisma.Decimal | null
    movementCount: bigint
  }[]> {
    const inDay = Prisma.sql`m."createdAt" >= ${start} AND m."createdAt" < ${end}`
    const flow = (name: DayFlow | 'other', condition: Prisma.Sql) => Prisma.sql`
      SUM(m.quantity)          FILTER (WHERE ${inDay} AND ${condition}) AS ${Prisma.raw(`"${name}Qty"`)},
      SUM(m.quantity * c.cost) FILTER (WHERE ${inDay} AND ${condition}) AS ${Prisma.raw(`"${name}Value"`)},`

    return prisma.$queryRaw`
      SELECT good.id AS "finishedGoodId", good.code AS "finishedGoodCode", good.name AS "finishedGoodName",
             unit.abbreviation AS "unitAbbreviation", branch.id AS "branchId", branch.name AS "branchName",
             SUM(m.quantity)          FILTER (WHERE m."createdAt" < ${start}) AS "openingQty",
             SUM(m.quantity * c.cost) FILTER (WHERE m."createdAt" < ${start}) AS "openingValue",
             ${Prisma.join(DAY_FLOWS.map(([name, condition]) => flow(name, condition)), ' ')}
             ${flow('other', Prisma.sql`NOT ${KNOWN_FLOW}`)}
             SUM(m.quantity)          AS "closingQty",
             SUM(m.quantity * c.cost) AS "closingValue",
             COUNT(*) FILTER (WHERE ${inDay}) AS "movementCount"
      FROM "FinishedGoodMovement" AS m
      JOIN "FinishedGoodLot" AS lot    ON lot.id = m."lotId"
      JOIN "FinishedGood"    AS good   ON good.id = lot."finishedGoodId"
      JOIN "Unit"            AS unit   ON unit.id = good."unitId"
      JOIN "Branch"          AS branch ON branch.id = m."branchId"
      ${LOT_COST}
      WHERE m."createdAt" < ${end}
        ${branchId === null ? Prisma.empty : Prisma.sql`AND m."branchId" = ${branchId}`}
      GROUP BY good.id, good.code, good.name, unit.abbreviation, branch.id, branch.name
      ORDER BY branch.name, good.name
    `
  },

  /**
   * The documents behind one business day's figures (Week 7 Task 4, E3): per
   * source document, flow, finished good and branch, the quantity and its
   * value at the lots' recorded cost, the lots touched and when the stock
   * moved — classified by the same DAY_FLOWS as dayFlows, so each flow's
   * documents add up to its figure. Oldest first.
   */
  async dayDocuments(start: Date, end: Date, branchId: string | null): Promise<{
    flow: DayFlow | 'other'
    referenceType: string; referenceId: string
    finishedGoodName: string; finishedGoodCode: string; unitAbbreviation: string
    branchName: string
    lotNumbers: string[]
    quantity: Prisma.Decimal; value: Prisma.Decimal | null
    movedAt: Date
  }[]> {
    const flowCase = Prisma.join(DAY_FLOWS.map(([name, condition]) => Prisma.sql`WHEN ${condition} THEN ${name}`), ' ')
    return prisma.$queryRaw`
      SELECT CASE ${flowCase} ELSE 'other' END AS flow,
             m."referenceType", m."referenceId",
             good.name AS "finishedGoodName", good.code AS "finishedGoodCode", unit.abbreviation AS "unitAbbreviation",
             branch.name AS "branchName",
             array_agg(DISTINCT lot."lotNumber" ORDER BY lot."lotNumber") AS "lotNumbers",
             SUM(m.quantity) AS quantity, SUM(m.quantity * c.cost) AS value,
             MIN(m."createdAt") AS "movedAt"
      FROM "FinishedGoodMovement" AS m
      JOIN "FinishedGoodLot" AS lot    ON lot.id = m."lotId"
      JOIN "FinishedGood"    AS good   ON good.id = lot."finishedGoodId"
      JOIN "Unit"            AS unit   ON unit.id = good."unitId"
      JOIN "Branch"          AS branch ON branch.id = m."branchId"
      ${LOT_COST}
      WHERE m."createdAt" >= ${start} AND m."createdAt" < ${end}
        ${branchId === null ? Prisma.empty : Prisma.sql`AND m."branchId" = ${branchId}`}
      GROUP BY m.type, m."referenceType", m."referenceId", good.id, good.name, good.code, unit.abbreviation, branch.id, branch.name
      ORDER BY "movedAt", good.name
    `
  },

  /**
   * What the stock levels hold now, per finished good and branch — compared
   * with today's closing figure from the ledger on the End of Day page.
   */
  async levelTotals(branchId: string | null): Promise<{ finishedGoodId: string; branchId: string; quantity: Prisma.Decimal }[]> {
    return prisma.$queryRaw`
      SELECT lot."finishedGoodId", level."branchId", SUM(level.quantity) AS quantity
      FROM "FinishedGoodLevel" AS level
      JOIN "FinishedGoodLot"   AS lot ON lot.id = level."lotId"
      ${branchId === null ? Prisma.empty : Prisma.sql`WHERE level."branchId" = ${branchId}`}
      GROUP BY lot."finishedGoodId", level."branchId"
    `
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
