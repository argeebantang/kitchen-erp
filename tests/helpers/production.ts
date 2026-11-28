import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { todayIsoDate } from '@/lib/dates'
import { InventoryRepository } from '@/repositories/inventory.repository'
import { ProductionOrderService } from '@/services/production-order.service'
import type { World } from './fixtures'
import { as, ok } from './procurement'

/**
 * Production as test steps, each through the real service. Lots can only come
 * from a production run or a conversion (a CHECK constraint on
 * FinishedGoodLot), so a test that needs Lechon on hand cooks it here.
 */

type Person = { id: string; role: string }

/** Raw materials on the kitchen's shelf before a test starts — the given, not what is tested. */
export async function stockMaterials(world: World, quantities: { pork?: string; salt?: string }) {
  await prisma.$transaction(async tx => {
    for (const [key, quantity] of Object.entries(quantities)) {
      const material = world.materials[key as 'pork' | 'salt']
      await InventoryRepository.stockIn(tx, {
        materialId: material.id, branchId: world.branches.kitchen.id, quantity: new Prisma.Decimal(quantity),
        unitCost: null, referenceType: 'TestSetup', referenceId: 'test-setup', notes: null,
      })
    }
  })
}

/** A Lechon order of `batchCount` × 10 kg for today, created and submitted by `by`. */
export async function submittedRun(world: World, batchCount = 1, by: Person = world.users.production) {
  const order = ok(await ProductionOrderService.create({
    finishedGoodId: world.finishedGoods.lechon.id,
    batchWeight:    '10',
    batchCount,
    plannedDate:    todayIsoDate(),
    branchId:       world.branches.kitchen.id,
  }, as(by)))
  ok(await ProductionOrderService.submit(order.id, as(by)))
  return order
}

/** Approved, started and reported done with `yieldQty`: waiting for accounting to sign the completion off. */
export async function reportedRun(world: World, yieldQty: string, batchCount = 1, by: Person = world.users.production) {
  const order = await submittedRun(world, batchCount, by)
  ok(await ProductionOrderService.applyDecision(order.id, as(world.users.accounting), 'APPROVED', null))
  ok(await ProductionOrderService.start(order.id, as(by)))
  ok(await ProductionOrderService.complete(order.id, as(by), yieldQty))
  return order
}

/** A completed run: its lot of Lechon is on hand at the kitchen. */
export async function completedRun(world: World, yieldQty: string, batchCount = 1) {
  const order = await reportedRun(world, yieldQty, batchCount)
  ok(await ProductionOrderService.applyCompletionDecision(order.id, as(world.users.accounting), 'APPROVED', null))
  return order
}

/**
 * A lot of Lechon on hand, cooked through the real flow (1 batch: ₱3,020 of
 * ingredients ÷ the yield), then aged: its expiry moved to `expiresInHours`
 * from now (negative = already expired). Returns the lot.
 */
export async function lechonLot(world: World, yieldQty: string, expiresInHours: number) {
  const order = await completedRun(world, yieldQty)
  return prisma.finishedGoodLot.update({
    where: { productionOrderId: order.id },
    data:  { expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000) },
  })
}

/** A finished-good lot's quantity at a branch, as a string ('0' when it has none there). */
export async function lotQuantity(lotId: string, branchId: string): Promise<string> {
  const level = await prisma.finishedGoodLevel.findUnique({ where: { lotId_branchId: { lotId, branchId } } })
  return level ? level.quantity.toString() : '0'
}
