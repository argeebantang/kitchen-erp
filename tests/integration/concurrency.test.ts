import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { PurchaseRequestService } from '@/services/purchase-request.service'
import { ReceivingReportService } from '@/services/receiving-report.service'
import { ProductionOrderService } from '@/services/production-order.service'
import { ConversionOrderService } from '@/services/conversion-order.service'
import { WriteOffService } from '@/services/write-off.service'
import { StockTransferService } from '@/services/stock-transfer.service'
import { createWorld, type World } from '../helpers/fixtures'
import { as, ok, orderReadyToReceive, stockOf, submittedReceipt, submittedRequest } from '../helpers/procurement'
import { lechonLot, lotQuantity, reportedRun } from '../helpers/production'

/**
 * Two people deciding the same document at the same moment. Each test fires
 * both calls together (Promise.all), so both read the document as pending and
 * both reach the database: what stops the second is the race guard there —
 * the expected status in the UPDATE's WHERE, and the row locks
 * (docs/architecture.md, "Patterns in use") — not the service's earlier read.
 *
 * Every case: exactly one succeeds, the other gets 409, and stock moves once.
 */

type Result = { success: boolean; status?: number }

let world: World
let kitchen: string

beforeEach(async () => {
  world = await createWorld()
  kitchen = world.branches.kitchen.id
})

/** Both calls at once; returns their results with exactly one success checked. */
async function race(first: () => Promise<Result>, second: () => Promise<Result>): Promise<Result[]> {
  const results = await Promise.all([first(), second()])
  expect(results.filter(r => r.success)).toHaveLength(1)
  expect(results.filter(r => !r.success).map(r => r.status)).toEqual([409])
  return results
}

const accounting  = () => as(world.users.accounting)
const accounting2 = () => as(world.users.accounting2)

describe('two approvers on the same document at once', () => {
  it('purchase request: one purchase order, not two', async () => {
    const pr = await submittedRequest(world, [{ materialId: world.materials.pork.id, quantity: '100' }])

    await race(
      () => PurchaseRequestService.applyDecision(pr.id, accounting(), 'APPROVED', null),
      () => PurchaseRequestService.applyDecision(pr.id, accounting2(), 'APPROVED', null),
    )
    expect(await prisma.purchaseOrder.count()).toBe(1)
    expect(await prisma.approval.count({ where: { referenceId: pr.id } })).toBe(1)
  })

  it('one approves, the other rejects: one decision stands', async () => {
    const pr = await submittedRequest(world, [{ materialId: world.materials.pork.id, quantity: '100' }])

    await race(
      () => PurchaseRequestService.applyDecision(pr.id, accounting(), 'APPROVED', null),
      () => PurchaseRequestService.applyDecision(pr.id, accounting2(), 'REJECTED', 'Over budget'),
    )
    const request = await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: pr.id } })
    expect(['CONVERTED_TO_PO', 'REJECTED']).toContain(request.status)
    expect(await prisma.purchaseOrder.count()).toBe(request.status === 'CONVERTED_TO_PO' ? 1 : 0)
  })

  it('receiving report: the delivery is stocked once', async () => {
    const po = await orderReadyToReceive(world, [{ materialId: world.materials.pork.id, quantity: '100' }])
    const rr = await submittedReceipt(world, po.id, { [world.materials.pork.id]: { received: '100' } })

    await race(
      () => ReceivingReportService.applyDecision(rr.id, accounting(), 'APPROVED', null),
      () => ReceivingReportService.applyDecision(rr.id, accounting2(), 'APPROVED', null),
    )
    expect(await stockOf(world.materials.pork.id, kitchen)).toBe('100')
    expect(await prisma.stockMovement.count({ where: { referenceId: rr.id } })).toBe(1)
  })

  it('production completion: the ingredients go out once, one lot comes in', async () => {
    const order = await reportedRun(world, '10')

    await race(
      () => ProductionOrderService.applyCompletionDecision(order.id, accounting(), 'APPROVED', null),
      () => ProductionOrderService.applyCompletionDecision(order.id, accounting2(), 'APPROVED', null),
    )
    expect(await stockOf(world.materials.pork.id, kitchen)).toBe('-12')
    expect(await prisma.finishedGoodLot.count()).toBe(1)
  })

  it('conversion: the Lechon is taken once, one Paksiw lot comes in', async () => {
    const lot = await lechonLot(world, '10', 40)
    const conversion = ok(await ConversionOrderService.create({ bomId: world.boms.paksiw.id, branchId: kitchen, sourceQty: '5', outputQty: '6' }, as(world.users.production)))

    await race(
      () => ConversionOrderService.applyDecision(conversion.id, accounting(), 'APPROVED', null),
      () => ConversionOrderService.applyDecision(conversion.id, accounting2(), 'APPROVED', null),
    )
    expect(await lotQuantity(lot.id, kitchen)).toBe('5')
    expect(await prisma.finishedGoodLot.count({ where: { conversionOrderId: conversion.id } })).toBe(1)
  })

  it('write-off: the waste is taken once', async () => {
    const lot = await lechonLot(world, '10', -1)
    const writeOff = ok(await WriteOffService.create({ lotId: lot.id, branchId: kitchen, quantity: '4', reason: 'EXPIRED' }, as(world.users.production)))

    await race(
      () => WriteOffService.applyDecision(writeOff.id, accounting(), 'APPROVED', null),
      () => WriteOffService.applyDecision(writeOff.id, accounting2(), 'APPROVED', null),
    )
    expect(await lotQuantity(lot.id, kitchen)).toBe('6')
    expect(await prisma.finishedGoodMovement.count({ where: { referenceId: writeOff.id } })).toBe(1)
  })

  it('transfer: dispatched once', async () => {
    const lot = await lechonLot(world, '10', 40)
    const transfer = ok(await StockTransferService.create(
      { fromBranchId: kitchen, toBranchId: world.branches.outlet.id, lines: [{ finishedGoodId: world.finishedGoods.lechon.id, quantity: '6' }] },
      as(world.users.production),
    ))

    await race(
      () => StockTransferService.applyDecision(transfer.id, accounting(), 'APPROVED', null),
      () => StockTransferService.applyDecision(transfer.id, accounting2(), 'APPROVED', null),
    )
    expect(await lotQuantity(lot.id, kitchen)).toBe('4')
    expect(await prisma.finishedGoodMovement.count({ where: { referenceId: transfer.id } })).toBe(1)
  })

  it('transfer receipt counted twice at once: the outlet gets it once', async () => {
    const lot = await lechonLot(world, '10', 40)
    const outlet = world.branches.outlet.id
    const transfer = ok(await StockTransferService.create(
      { fromBranchId: kitchen, toBranchId: outlet, lines: [{ finishedGoodId: world.finishedGoods.lechon.id, quantity: '6' }] },
      as(world.users.production),
    ))
    ok(await StockTransferService.applyDecision(transfer.id, accounting(), 'APPROVED', null))
    const count = { lots: [{ lotId: lot.id, received: '6' }], reason: null, notes: null }

    await race(
      () => StockTransferService.receive(transfer.id, as(world.users.branchManager), count),
      () => StockTransferService.receive(transfer.id, as(world.users.admin), count),
    )
    expect(await lotQuantity(lot.id, outlet)).toBe('6')
  })
})

describe('different documents on the same Lechon at once', () => {
  it('a conversion, a transfer and a write-off all go through, and the lot adds up to exactly zero', async () => {
    const lot = await lechonLot(world, '10', 40)
    const production = as(world.users.production)
    // 3 kg written off (damaged), 4 kg converted, 3 kg sent: exactly the 10 kg on hand.
    const writeOff = ok(await WriteOffService.create({ lotId: lot.id, branchId: kitchen, quantity: '3', reason: 'DAMAGED', notes: 'Tray dropped' }, production))
    const conversion = ok(await ConversionOrderService.create({ bomId: world.boms.paksiw.id, branchId: kitchen, sourceQty: '4', outputQty: '4.8' }, production))
    const transfer = ok(await StockTransferService.create(
      { fromBranchId: kitchen, toBranchId: world.branches.outlet.id, lines: [{ finishedGoodId: world.finishedGoods.lechon.id, quantity: '3' }] }, production,
    ))

    // All three approved at the same moment: the lot locks must serialise them without deadlocking.
    const results = await Promise.all([
      WriteOffService.applyDecision(writeOff.id, accounting(), 'APPROVED', null),
      ConversionOrderService.applyDecision(conversion.id, accounting2(), 'APPROVED', null),
      StockTransferService.applyDecision(transfer.id, accounting(), 'APPROVED', null),
    ])
    expect(results.map(r => r.success)).toEqual([true, true, true])
    expect(await lotQuantity(lot.id, kitchen)).toBe('0')

    const out = await prisma.finishedGoodMovement.aggregate({ where: { lotId: lot.id, branchId: kitchen, type: { not: 'IN' } }, _sum: { quantity: true } })
    expect(out._sum.quantity?.toString()).toBe('-10')
  })
})
