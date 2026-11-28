import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { getNotificationQueue } from '@/lib/queue'
import { PurchaseRequestService } from '@/services/purchase-request.service'
import { PurchaseOrderService } from '@/services/purchase-order.service'
import { ReceivingReportService } from '@/services/receiving-report.service'
import { createWorld, type World } from '../helpers/fixtures'
import {
  approveRequest, as, countInput, ok, orderReadyToReceive, sentOrder, stockOf, submittedReceipt, submittedRequest, type Count,
} from '../helpers/procurement'

/**
 * Procurement end to end, through the services against a real database:
 * purchase request → purchase order → receiving report → stock.
 *
 * The fixture world: Main Kitchen, Whole Pig (₱250/kg reference price) and
 * Rock Salt (₱40/kg). Every test orders 100 kg pork and 10 kg salt unless it
 * says otherwise.
 */

let world: World
let pork: string
let salt: string
let kitchen: string
const order = () => [{ materialId: pork, quantity: '100' }, { materialId: salt, quantity: '10' }]

beforeEach(async () => {
  world = await createWorld()
  pork = world.materials.pork.id
  salt = world.materials.salt.id
  kitchen = world.branches.kitchen.id
})

describe('the whole flow', () => {
  it('turns an approved request into an order, and an approved delivery into stock', async () => {
    const pr = await submittedRequest(world, order())

    const po = await approveRequest(pr.id, world.users.accounting)
    const request = await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: pr.id } })
    expect(request.status).toBe('CONVERTED_TO_PO')

    // The order copies the request's lines at the reference prices.
    const items = await prisma.purchaseOrderItem.findMany({ where: { purchaseOrderId: po.id }, orderBy: { unitCost: 'desc' } })
    expect(items.map(item => [item.materialId, item.quantity.toString(), item.unitCost.toString(), item.totalCost.toString()])).toEqual([
      [pork, '100', '250', '25000'],
      [salt, '10', '40', '400'],
    ])

    await sentOrder(world, po.id)
    const rr = await submittedReceipt(world, po.id, { [pork]: { received: '100' }, [salt]: { received: '10' } })

    // Nothing moves until accounting approves the count.
    expect(await stockOf(pork, kitchen)).toBe('0')

    ok(await ReceivingReportService.applyDecision(rr.id, as(world.users.accounting), 'APPROVED', null))

    expect(await stockOf(pork, kitchen)).toBe('100')
    expect(await stockOf(salt, kitchen)).toBe('10')
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe('FULLY_RECEIVED')

    // One IN ledger row per line, at the order's cost, pointing at the report.
    const movements = await prisma.stockMovement.findMany({ where: { referenceType: 'ReceivingReport', referenceId: rr.id }, orderBy: { quantity: 'desc' } })
    expect(movements.map(m => [m.materialId, m.branchId, m.type, m.quantity.toString(), m.unitCost?.toString()])).toEqual([
      [pork, kitchen, 'IN', '100', '250'],
      [salt, kitchen, 'IN', '10', '40'],
    ])

    // Every decision is on record, by the person who made it.
    const approvals = await prisma.approval.findMany({ orderBy: { decidedAt: 'asc' } })
    expect(approvals.map(a => [a.referenceType, a.decision, a.approverId])).toEqual([
      ['PurchaseRequest', 'APPROVED', world.users.accounting.id],
      ['PurchaseOrder', 'APPROVED', world.users.accounting.id],
      ['ReceivingReport', 'APPROVED', world.users.accounting.id],
    ])
  })

  it('re-prices the order for the chosen supplier, falling back to the reference price', async () => {
    const pr = await submittedRequest(world, order())
    const po = await approveRequest(pr.id, world.users.accounting)
    // The supplier has its own pork price; salt has only the reference price.
    await prisma.itemPrice.create({
      data: { materialId: pork, supplierId: world.supplier.id, unitPrice: '240', effectiveDate: new Date(Date.now() - 60_000) },
    })

    const updated = ok(await PurchaseOrderService.updateDraft(po.id, { supplierId: world.supplier.id }, as(world.users.procurement)))

    const items = await prisma.purchaseOrderItem.findMany({ where: { purchaseOrderId: po.id }, orderBy: { unitCost: 'desc' } })
    expect(items.map(item => [item.materialId, item.unitCost.toString(), item.totalCost.toString()])).toEqual([
      [pork, '240', '24000'],
      [salt, '40', '400'],
    ])
    expect(updated.totalAmount).toBe('24400')
  })

  it('queues a notification for the approvers when a request is submitted', async () => {
    const pr = await submittedRequest(world, order())
    const jobs = await getNotificationQueue().getJobs(['waiting', 'delayed', 'prioritized'])
    expect(jobs.map(job => [job.name, job.data])).toContainEqual(['pr-submitted', { purchaseRequestId: pr.id }])
  })
})

describe('receiving in more than one delivery', () => {
  it('adds each approved delivery to stock and tracks what is still outstanding', async () => {
    const po = await orderReadyToReceive(world, order())

    const first = await submittedReceipt(world, po.id, { [pork]: { received: '60' }, [salt]: { received: '10' } })
    ok(await ReceivingReportService.applyDecision(first.id, as(world.users.accounting), 'APPROVED', null))
    expect(await stockOf(pork, kitchen)).toBe('60')
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe('PARTIALLY_RECEIVED')

    // Only 40 kg pork is outstanding now; the second count is measured against that.
    const tooMuch = await ReceivingReportService.create(await countInput(world, po.id, { [pork]: { received: '41' }, [salt]: { received: '0' } }), as(world.users.procurement))
    expect(tooMuch).toMatchObject({ success: false, status: 400, error: expect.stringContaining('only 40 kg is outstanding') })

    const second = await submittedReceipt(world, po.id, { [pork]: { received: '40' }, [salt]: { received: '0' } })
    ok(await ReceivingReportService.applyDecision(second.id, as(world.users.accounting), 'APPROVED', null))
    expect(await stockOf(pork, kitchen)).toBe('100')
    expect(await stockOf(salt, kitchen)).toBe('10')
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe('FULLY_RECEIVED')
  })

  it('allows only one open report per order', async () => {
    const po = await orderReadyToReceive(world, order())
    await submittedReceipt(world, po.id, { [pork]: { received: '50' }, [salt]: { received: '0' } })

    const another = await ReceivingReportService.create(await countInput(world, po.id, { [pork]: { received: '50' }, [salt]: { received: '0' } }), as(world.users.procurement))
    expect(another).toMatchObject({ success: false, status: 409 })
  })
})

describe('what the count accepts', () => {
  it('stocks only what was accepted: received minus rejected', async () => {
    const po = await orderReadyToReceive(world, order())
    const rr = await submittedReceipt(world, po.id, {
      [pork]: { received: '100', rejected: '5', notes: 'Two pigs arrived warm' },
      [salt]: { received: '10' },
    })
    ok(await ReceivingReportService.applyDecision(rr.id, as(world.users.accounting), 'APPROVED', null))

    expect(await stockOf(pork, kitchen)).toBe('95')
    // 5 kg pork is still owed, so the order is not complete.
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe('PARTIALLY_RECEIVED')
  })

  it.each<[string, Count, string]>([
    ['more than is outstanding', { received: '120' }, 'only 100 kg is outstanding — enter the extra as rejected'],
    ['more rejected than received', { received: '10', rejected: '11', notes: 'x' }, 'rejected cannot be more than received'],
    ['a rejection with no reason', { received: '100', rejected: '5' }, 'a rejected quantity needs a note saying why'],
  ])('refuses %s', async (_label, porkCount, message) => {
    const po = await orderReadyToReceive(world, order())
    const input = await countInput(world, po.id, { [pork]: porkCount, [salt]: { received: '10' } })

    const result = await ReceivingReportService.create(input, as(world.users.procurement))
    expect(result).toMatchObject({ success: false, status: 400, error: expect.stringContaining(message) })
    expect(await prisma.receivingReport.count()).toBe(0)
  })

  it('refuses a count that leaves out a line', async () => {
    const po = await orderReadyToReceive(world, order())
    const input = await countInput(world, po.id, { [pork]: { received: '100' }, [salt]: { received: '10' } })
    input.items = input.items.slice(0, 1)

    const result = await ReceivingReportService.create(input, as(world.users.procurement))
    expect(result).toMatchObject({ success: false, status: 400, error: expect.stringContaining('Every line on the order needs a count') })
  })

  it('receives deliveries at a kitchen only — outlets hold no raw materials', async () => {
    const po = await orderReadyToReceive(world, order())
    const input = await countInput(world, po.id, { [pork]: { received: '100' }, [salt]: { received: '10' } }, world.branches.outlet.id)

    const result = await ReceivingReportService.create(input, as(world.users.procurement))
    expect(result).toMatchObject({ success: false, status: 400, error: expect.stringContaining('is an outlet') })
  })

  it('refuses a receiving date in the future', async () => {
    const po = await orderReadyToReceive(world, order())
    const input = await countInput(world, po.id, { [pork]: { received: '100' }, [salt]: { received: '10' } })
    input.receivedAt = '2999-01-01'

    expect(await ReceivingReportService.create(input, as(world.users.procurement))).toMatchObject({ success: false, status: 400 })
  })
})

describe('a rejected delivery', () => {
  it('moves no stock, leaves the order open, and lets a fresh count be recorded', async () => {
    const po = await orderReadyToReceive(world, order())
    const rr = await submittedReceipt(world, po.id, { [pork]: { received: '100' }, [salt]: { received: '10' } })

    ok(await ReceivingReportService.applyDecision(rr.id, as(world.users.accounting), 'REJECTED', 'Scale was not zeroed — recount'))

    expect(await stockOf(pork, kitchen)).toBe('0')
    expect(await prisma.stockMovement.count()).toBe(0)
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe('SENT')

    const recount = await ReceivingReportService.create(await countInput(world, po.id, { [pork]: { received: '100' }, [salt]: { received: '10' } }), as(world.users.procurement))
    expect(recount.success).toBe(true)
  })
})

describe('nobody approves their own work, ADMIN included', () => {
  it('refuses the requester deciding their own purchase request', async () => {
    const pr = await submittedRequest(world, order(), world.users.admin)

    const result = await PurchaseRequestService.applyDecision(pr.id, as(world.users.admin), 'APPROVED', null)
    expect(result).toMatchObject({ success: false, status: 403 })
    expect((await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: pr.id } })).status).toBe('PENDING_APPROVAL')
    expect(await prisma.purchaseOrder.count()).toBe(0)
  })

  it('refuses whoever submitted a purchase order deciding it', async () => {
    const pr = await submittedRequest(world, order())
    const po = await approveRequest(pr.id, world.users.accounting)
    ok(await PurchaseOrderService.updateDraft(po.id, { supplierId: world.supplier.id }, as(world.users.admin)))
    ok(await PurchaseOrderService.submit(po.id, as(world.users.admin)))

    const result = await PurchaseOrderService.applyDecision(po.id, as(world.users.admin), 'APPROVED', null)
    expect(result).toMatchObject({ success: false, status: 403 })
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe('PENDING_APPROVAL')
  })

  it('refuses whoever counted a delivery deciding it', async () => {
    const po = await orderReadyToReceive(world, order())
    const rr = await submittedReceipt(world, po.id, { [pork]: { received: '100' }, [salt]: { received: '10' } }, world.users.admin)

    const result = await ReceivingReportService.applyDecision(rr.id, as(world.users.admin), 'APPROVED', null)
    expect(result).toMatchObject({ success: false, status: 403 })
    expect(await stockOf(pork, kitchen)).toBe('0')
  })
})

describe('decisions', () => {
  it('needs a reason to reject, and a rejection creates no order', async () => {
    const pr = await submittedRequest(world, order())

    for (const remarks of [null, '', '   ']) {
      const result = await PurchaseRequestService.applyDecision(pr.id, as(world.users.accounting), 'REJECTED', remarks)
      expect(result).toMatchObject({ success: false, status: 400, error: 'Give a reason when rejecting' })
    }

    ok(await PurchaseRequestService.applyDecision(pr.id, as(world.users.accounting), 'REJECTED', 'Over budget this week'))
    expect((await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: pr.id } })).status).toBe('REJECTED')
    expect(await prisma.purchaseOrder.count()).toBe(0)
  })

  it('refuses a second decision on a request, and creates only one order', async () => {
    const pr = await submittedRequest(world, order())
    await approveRequest(pr.id, world.users.accounting)

    const again = await PurchaseRequestService.applyDecision(pr.id, as(world.users.accounting2), 'APPROVED', null)
    expect(again).toMatchObject({ success: false, status: 409 })
    expect(await prisma.purchaseOrder.count()).toBe(1)
  })

  it('refuses a second decision on a delivery, and stocks it only once', async () => {
    const po = await orderReadyToReceive(world, order())
    const rr = await submittedReceipt(world, po.id, { [pork]: { received: '100' }, [salt]: { received: '10' } })
    ok(await ReceivingReportService.applyDecision(rr.id, as(world.users.accounting), 'APPROVED', null))

    const again = await ReceivingReportService.applyDecision(rr.id, as(world.users.accounting2), 'APPROVED', null)
    expect(again).toMatchObject({ success: false, status: 409 })
    expect(await stockOf(pork, kitchen)).toBe('100')
    expect(await prisma.stockMovement.count({ where: { referenceId: rr.id } })).toBe(2)
  })

  it('will not approve a request with an unpriced line', async () => {
    const garlic = await prisma.material.create({
      data: { code: 'RM-GARLIC', name: 'Garlic', categoryId: world.categories.spices.id, unitId: world.units.kg.id },
    })
    const pr = await submittedRequest(world, [{ materialId: garlic.id, quantity: '3' }])

    const result = await PurchaseRequestService.applyDecision(pr.id, as(world.users.accounting), 'APPROVED', null)
    expect(result).toMatchObject({ success: false, status: 400, error: expect.stringContaining('Garlic has no price on record') })
    expect((await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: pr.id } })).status).toBe('PENDING_APPROVAL')
  })
})

describe('who does what', () => {
  it('keeps sourcing with procurement: accounting cannot edit or submit an order', async () => {
    const pr = await submittedRequest(world, order())
    const po = await approveRequest(pr.id, world.users.accounting)

    expect(await PurchaseOrderService.updateDraft(po.id, { supplierId: world.supplier.id }, as(world.users.accounting))).toMatchObject({ success: false, status: 403 })
    expect(await PurchaseOrderService.submit(po.id, as(world.users.accounting))).toMatchObject({ success: false, status: 403 })
  })

  it('will not submit an order without a supplier', async () => {
    const pr = await submittedRequest(world, order())
    const po = await approveRequest(pr.id, world.users.accounting)

    const result = await PurchaseOrderService.submit(po.id, as(world.users.procurement))
    expect(result).toMatchObject({ success: false, status: 400, error: 'Choose a supplier before submitting' })
  })

  it('lets only procurement record a delivery', async () => {
    const po = await orderReadyToReceive(world, order())
    const input = await countInput(world, po.id, { [pork]: { received: '100' }, [salt]: { received: '10' } })

    for (const user of [world.users.branchManager, world.users.accounting, world.users.production]) {
      expect(await ReceivingReportService.create(input, as(user))).toMatchObject({ success: false, status: 403 })
    }
  })

  it('cannot receive against an order that was never sent', async () => {
    const pr = await submittedRequest(world, order())
    const po = await approveRequest(pr.id, world.users.accounting)
    const input = await countInput(world, po.id, { [pork]: { received: '100' }, [salt]: { received: '10' } })

    expect(await ReceivingReportService.create(input, as(world.users.procurement))).toMatchObject({ success: false, status: 409 })
  })

  it('sends deliveries to a kitchen: a request for an outlet is refused', async () => {
    const result = await PurchaseRequestService.create({ requestedById: world.users.procurement.id, deliverToId: world.branches.outlet.id, items: order() })
    expect(result).toMatchObject({ success: false, status: 400 })
  })
})
