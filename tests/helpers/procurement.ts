import { prisma } from '@/lib/prisma'
import { todayIsoDate } from '@/lib/dates'
import { PurchaseRequestService } from '@/services/purchase-request.service'
import { PurchaseOrderService } from '@/services/purchase-order.service'
import { ReceivingReportService } from '@/services/receiving-report.service'
import type { World } from './fixtures'

/**
 * The procurement workflow as test steps, each through the real service, as
 * the API routes call them. A step that should succeed unwraps the result with
 * ok(), so a broken step fails with the service's own message rather than a
 * confusing assertion further on.
 */

type Result<T> = { success: true; data: T } | { success: false; error: string; status: number }
type Person = { id: string; role: string }

export const as = (user: Person) => ({ userId: user.id, role: user.role })

/** The data of a result that must have succeeded. */
export function ok<T>(result: Result<T>): T {
  if (!result.success) throw new Error(`Expected success, got ${result.status}: ${result.error}`)
  return result.data
}

/** A purchase request for the kitchen, raised and submitted by `by`. Unpriced lines take the reference price. */
export async function submittedRequest(world: World, lines: { materialId: string; quantity: string }[], by: Person = world.users.procurement) {
  const pr = ok(await PurchaseRequestService.create({ requestedById: by.id, deliverToId: world.branches.kitchen.id, items: lines }))
  ok(await PurchaseRequestService.submit(pr.id, as(by)))
  return pr
}

/** Approve a request; returns the purchase order the approval created (a DRAFT with no supplier). */
export async function approveRequest(prId: string, approver: Person) {
  const pr = ok(await PurchaseRequestService.applyDecision(prId, as(approver), 'APPROVED', null))
  const [po] = pr.purchaseOrders
  if (!po) throw new Error('Approving the request created no purchase order')
  return po
}

/** Supplier chosen, submitted, approved and sent: an order ready to receive against. */
export async function sentOrder(world: World, poId: string, by: Person = world.users.procurement, approver: Person = world.users.accounting) {
  ok(await PurchaseOrderService.updateDraft(poId, { supplierId: world.supplier.id }, as(by)))
  ok(await PurchaseOrderService.submit(poId, as(by)))
  ok(await PurchaseOrderService.applyDecision(poId, as(approver), 'APPROVED', null))
  ok(await PurchaseOrderService.markSent(poId, as(by)))
}

/** From nothing to a SENT order for these lines — the usual starting point for receiving. */
export async function orderReadyToReceive(world: World, lines: { materialId: string; quantity: string }[]) {
  const pr = await submittedRequest(world, lines)
  const po = await approveRequest(pr.id, world.users.accounting)
  await sentOrder(world, po.id)
  return po
}

/** The order's line ids by material, for filling in a count. */
export async function orderLines(poId: string): Promise<Map<string, string>> {
  const items = await prisma.purchaseOrderItem.findMany({ where: { purchaseOrderId: poId }, select: { id: true, materialId: true } })
  return new Map(items.map(item => [item.materialId, item.id]))
}

export type Count = { received: string; rejected?: string; notes?: string }

/** The receiving input for a count per material; every order line needs one. */
export async function countInput(world: World, poId: string, counts: Record<string, Count>, branchId = world.branches.kitchen.id) {
  const lines = await orderLines(poId)
  return {
    purchaseOrderId: poId,
    branchId,
    receivedAt: todayIsoDate(),
    items: [...lines].map(([materialId, purchaseOrderItemId]) => {
      const count = counts[materialId]
      if (!count) throw new Error(`No count given for material ${materialId}`)
      return {
        purchaseOrderItemId,
        receivedQuantity: count.received,
        rejectedQuantity: count.rejected ?? '0',
        notes: count.notes ?? null,
      }
    }),
  }
}

/** A delivery counted and submitted by `by`; returns the report, still PENDING_APPROVAL. */
export async function submittedReceipt(world: World, poId: string, counts: Record<string, Count>, by: Person = world.users.procurement) {
  const rr = ok(await ReceivingReportService.create(await countInput(world, poId, counts), as(by)))
  ok(await ReceivingReportService.submit(rr.id, as(by)))
  return rr
}

/** A material's stock level at a branch, as a string ('0' when it has never moved). */
export async function stockOf(materialId: string, branchId: string): Promise<string> {
  const level = await prisma.inventoryLevel.findUnique({ where: { materialId_branchId: { materialId, branchId } } })
  return level ? level.quantity.toString() : '0'
}
