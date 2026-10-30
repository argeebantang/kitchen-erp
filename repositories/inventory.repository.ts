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

export type StockInInput = {
  materialId: string
  branchId: string
  quantity: Prisma.Decimal
  unitCost: Prisma.Decimal | null
  referenceType: string
  referenceId: string
  notes: string | null
}

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
