import { MovementType, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * The stock ledger (StockMovement) and current levels (InventoryLevel).
 *
 * Writes will take a Prisma.TransactionClient, like
 * PurchaseOrderRepository.createDraftFromRequest: a movement and its level
 * change must commit together with the document that caused them
 * (docs/database.md), so the caller's transaction is passed in rather than
 * opened here.
 */
const movementInclude = {
  material: { select: { code: true, name: true, unit: { select: { abbreviation: true } } } },
  branch:   { select: { name: true } },
} satisfies Prisma.StockMovementInclude

export type StockMovementWithDetail = Prisma.StockMovementGetPayload<{
  include: typeof movementInclude
}>

export type LedgerFilters = {
  materialId?: string
  branchId?: string
  skip?: number
  take?: number
}

export type StockInInput = {
  materialId: string
  branchId: string
  quantity: Prisma.Decimal
  unitCost: Prisma.Decimal | null
  referenceType: string
  referenceId: string
  notes: string | null
}

/** Same fields as stock in; `quantity` is the positive amount leaving. */
export type StockOutInput = StockInInput

export const InventoryRepository = {
  /**
   * Stock coming in: one IN row on the ledger and the matching increase in
   * InventoryLevel, on the caller's transaction. One function for both, so no
   * caller can write one without the other (docs/database.md).
   *
   * The level is an upsert on the (materialId, branchId) unique key with an
   * increment. Prisma runs that as a single INSERT … ON CONFLICT DO UPDATE
   * SET quantity = quantity + n, so two receipts of the same material — even
   * the first two, when no row exists yet — cannot lose an update.
   */
  async stockIn(tx: Prisma.TransactionClient, input: StockInInput): Promise<void> {
    await tx.stockMovement.create({
      data: {
        materialId:    input.materialId,
        branchId:      input.branchId,
        type:          MovementType.IN,
        quantity:      input.quantity,
        unitCost:      input.unitCost,
        referenceType: input.referenceType,
        referenceId:   input.referenceId,
        notes:         input.notes,
      },
    })

    await tx.inventoryLevel.upsert({
      where:  { materialId_branchId: { materialId: input.materialId, branchId: input.branchId } },
      create: { materialId: input.materialId, branchId: input.branchId, quantity: input.quantity },
      update: { quantity: { increment: input.quantity } },
    })
  },

  /**
   * Stock going out: one OUT row with the quantity negated (the ledger is
   * signed) and the matching decrease in InventoryLevel, on the caller's
   * transaction — stockIn's mirror. `quantity` is the positive amount taken.
   *
   * Nothing stops the level going below zero (Week 6 Task 2, D3): the books
   * record what physically left the shelf, and a negative balance shows a
   * delivery or adjustment that was never recorded. A material that has never
   * been stocked at the branch gets its level row created at the negative.
   */
  async stockOut(tx: Prisma.TransactionClient, input: StockOutInput): Promise<void> {
    await tx.stockMovement.create({
      data: {
        materialId:    input.materialId,
        branchId:      input.branchId,
        type:          MovementType.OUT,
        quantity:      input.quantity.negated(),
        unitCost:      input.unitCost,
        referenceType: input.referenceType,
        referenceId:   input.referenceId,
        notes:         input.notes,
      },
    })

    await tx.inventoryLevel.upsert({
      where:  { materialId_branchId: { materialId: input.materialId, branchId: input.branchId } },
      create: { materialId: input.materialId, branchId: input.branchId, quantity: input.quantity.negated() },
      update: { quantity: { decrement: input.quantity } },
    })
  },

  /**
   * The ledger, newest first, paged — StockMovement grows without bound.
   * Filtered by material and/or branch; with both set it is served by
   * @@index([materialId, branchId, createdAt]). id breaks ties between rows
   * written in the same millisecond, so paging is stable.
   */
  async findMovements(filters: LedgerFilters = {}) {
    const where: Prisma.StockMovementWhereInput = {}
    if (filters.materialId) where.materialId = filters.materialId
    if (filters.branchId)   where.branchId   = filters.branchId

    const [rows, total] = await prisma.$transaction([
      prisma.stockMovement.findMany({
        where,
        include: movementInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip:    filters.skip ?? 0,
        take:    filters.take ?? 50,
      }),
      prisma.stockMovement.count({ where }),
    ])

    return { rows, total }
  },

  /**
   * Running balance after each of the given movements, for one material at
   * one branch. The window runs over that material's whole history at the
   * branch, oldest first, and only then is filtered to the page's ids — so the
   * figure is right on page 3 without loading pages 1–2 into Node. Quantities
   * are signed, so the running sum is the balance.
   */
  async runningBalances(materialId: string, branchId: string, ids: string[]): Promise<Map<string, Prisma.Decimal>> {
    if (ids.length === 0) return new Map()

    const rows = await prisma.$queryRaw<{ id: string; balance: Prisma.Decimal }[]>`
      SELECT id, balance FROM (
        SELECT id, SUM(quantity) OVER (ORDER BY "createdAt", id) AS balance
        FROM "StockMovement"
        WHERE "materialId" = ${materialId} AND "branchId" = ${branchId}
      ) AS history
      WHERE id IN (${Prisma.join(ids)})
    `
    return new Map(rows.map(row => [row.id, row.balance]))
  },

  /**
   * The ledger's total for one material at one branch beside InventoryLevel's
   * figure. They must be equal: every stock write goes through stockIn (and
   * its future siblings), which changes both. No level row counts as zero.
   */
  async reconcile(materialId: string, branchId: string): Promise<{ ledgerTotal: Prisma.Decimal; stockLevel: Prisma.Decimal }> {
    const [sum, level] = await prisma.$transaction([
      prisma.stockMovement.aggregate({ where: { materialId, branchId }, _sum: { quantity: true } }),
      prisma.inventoryLevel.findUnique({ where: { materialId_branchId: { materialId, branchId } }, select: { quantity: true } }),
    ])
    const zero = new Prisma.Decimal(0)
    return { ledgerTotal: sum._sum.quantity ?? zero, stockLevel: level?.quantity ?? zero }
  },

  /**
   * reconcile() for every material at every branch at once: the pairs whose
   * ledger total differs from InventoryLevel, with names for a message. A FULL
   * JOIN, so a level with no movements and movements with no level both count
   * (the missing side as 0). One statement, so one consistent snapshot.
   * Groups the whole ledger — fine for a daily job, not for a page.
   */
  async mismatchedLevels(): Promise<{
    materialName: string
    branchName: string
    unitAbbreviation: string
    ledgerTotal: Prisma.Decimal
    stockLevel: Prisma.Decimal
  }[]> {
    return prisma.$queryRaw`
      SELECT material.name AS "materialName", branch.name AS "branchName", unit.abbreviation AS "unitAbbreviation",
             pairs."ledgerTotal", pairs."stockLevel"
      FROM (
        SELECT COALESCE(level."materialId", ledger."materialId") AS "materialId",
               COALESCE(level."branchId", ledger."branchId")     AS "branchId",
               COALESCE(ledger.total, 0)                         AS "ledgerTotal",
               COALESCE(level.quantity, 0)                       AS "stockLevel"
        FROM "InventoryLevel" AS level
        FULL JOIN (
          SELECT "materialId", "branchId", SUM(quantity) AS total
          FROM "StockMovement"
          GROUP BY "materialId", "branchId"
        ) AS ledger ON ledger."materialId" = level."materialId" AND ledger."branchId" = level."branchId"
        WHERE COALESCE(ledger.total, 0) <> COALESCE(level.quantity, 0)
      ) AS pairs
      JOIN "Material" AS material ON material.id = pairs."materialId"
      JOIN "Unit"     AS unit     ON unit.id = material."unitId"
      JOIN "Branch"   AS branch   ON branch.id = pairs."branchId"
      ORDER BY branch.name, material.name
    `
  },

  /**
   * On-hand quantity per material at one branch, for the given materials. A
   * material with no level row there has never moved there, so it is absent
   * and the caller reads it as zero.
   */
  async levelsAtBranch(branchId: string, materialIds: string[]): Promise<Map<string, Prisma.Decimal>> {
    if (materialIds.length === 0) return new Map()
    const rows = await prisma.inventoryLevel.findMany({
      where:  { branchId, materialId: { in: materialIds } },
      select: { materialId: true, quantity: true },
    })
    return new Map(rows.map(row => [row.materialId, row.quantity]))
  },

  /**
   * Everything the stock map needs, read in one snapshot: active materials
   * (category, then name) and every level row. The service crosses them with
   * the active branches, so a material with no level row at a branch still
   * appears there, at zero.
   *
   * A level's updatedAt is when that material last moved at that branch:
   * every movement changes its level (stockIn), so the map never has to scan
   * StockMovement, which grows without bound. The page polls, so this matters.
   */
  async stockPositions() {
    const [materials, levels] = await prisma.$transaction([
      prisma.material.findMany({
        where:   { isActive: true },
        select:  {
          id: true, code: true, name: true, reorderPoint: true,
          unit:     { select: { abbreviation: true } },
          category: { select: { name: true } },
        },
        orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
      }),
      prisma.inventoryLevel.findMany({ select: { materialId: true, branchId: true, quantity: true, updatedAt: true } }),
    ])

    return { materials, levels }
  },

  /**
   * The movements one source document wrote, oldest first. Served by
   * @@index([referenceType, referenceId]) on StockMovement.
   */
  async findMovementsByReference(referenceType: string, referenceId: string): Promise<StockMovementWithDetail[]> {
    return prisma.stockMovement.findMany({
      where:   { referenceType, referenceId },
      include: movementInclude,
      orderBy: { createdAt: 'asc' },
    })
  },
}
