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
  /** The run that made it. */
  productionOrderId: string
  /** Date-only, UTC midnight. */
  producedOn: Date
  branchId: string
  quantity: Prisma.Decimal
  referenceType: string
  referenceId: string
  notes: string | null
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
        productionOrderId: input.productionOrderId,
        producedOn:        input.producedOn,
      },
      select: { id: true },
    })

    await tx.finishedGoodMovement.create({
      data: {
        lotId:         lot.id,
        branchId:      input.branchId,
        type:          MovementType.IN,
        quantity:      input.quantity,
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
   * Lots on hand: every lot-and-branch level that is not zero, newest
   * production first — the Finished Goods page (Week 6 Task 2, D10). Cooked
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
            lotNumber: true, producedOn: true, productionOrderId: true,
            finishedGood: { select: { id: true, code: true, name: true, unit: { select: { abbreviation: true } } } },
          },
        },
        branch: { select: { id: true, name: true } },
      },
      orderBy: [{ lot: { producedOn: 'desc' } }, { lot: { lotNumber: 'desc' } }],
      take: filters.take,
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
        lot:    { select: { lotNumber: true, producedOn: true, finishedGood: { select: { name: true, unit: { select: { abbreviation: true } } } } } },
        branch: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
  },
}
