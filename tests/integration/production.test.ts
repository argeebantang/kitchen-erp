import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { getAiQueue } from '@/lib/queue'
import { todayIsoDate } from '@/lib/dates'
import { ProductionOrderService } from '@/services/production-order.service'
import { ConversionOrderService } from '@/services/conversion-order.service'
import { WriteOffService } from '@/services/write-off.service'
import { StockTransferService } from '@/services/stock-transfer.service'
import { createWorld, type World } from '../helpers/fixtures'
import { as, ok, stockOf } from '../helpers/procurement'
import { completedRun, lechonLot, lotQuantity, reportedRun, stockMaterials, submittedRun } from '../helpers/production'

/**
 * Production, conversion and write-off, through the services against a real
 * database. The fixture world: Lechon cooked in 10 kg batches from 12 kg pork
 * (₱250/kg) + 0.5 kg salt (₱40/kg) — ₱3,020 of ingredients a batch, 48 h shelf
 * life; Lechon Paksiw converted from 5 kg leftover Lechon + 0.25 kg salt per
 * 6 kg, 24 h shelf life.
 */

let world: World
let kitchen: string
const HOUR = 60 * 60 * 1000
/** A Decimal column to n places, for figures that divide (cost per unit). */
const places = (value: Prisma.Decimal | null, n: number) => value?.toDecimalPlaces(n).toString() ?? null

beforeEach(async () => {
  world = await createWorld()
  kitchen = world.branches.kitchen.id
})

// ─── Production ──────────────────────────────────────────────────────────────

describe('a production run', () => {
  it('takes the recipe out of stock and puts the yield in as a costed lot when the completion is signed off', async () => {
    await stockMaterials(world, { pork: '100', salt: '10' })

    // 2 batches × 10 kg = 20 kg planned; the kitchen reports 18 kg.
    const order = await reportedRun(world, '18', 2)
    ok(await ProductionOrderService.applyCompletionDecision(order.id, as(world.users.accounting), 'APPROVED', null))

    const run = await prisma.productionOrder.findUniqueOrThrow({ where: { id: order.id } })
    expect(run.status).toBe('COMPLETED')

    // The recipe at the PLANNED quantity leaves stock: 24 kg pork, 1 kg salt.
    expect(await stockOf(world.materials.pork.id, kitchen)).toBe('76')
    expect(await stockOf(world.materials.salt.id, kitchen)).toBe('9')
    const out = await prisma.stockMovement.findMany({ where: { referenceType: 'ProductionOrder', referenceId: order.id }, orderBy: { quantity: 'asc' } })
    expect(out.map(m => [m.materialId, m.type, m.quantity.toString(), m.unitCost?.toString()])).toEqual([
      [world.materials.pork.id, 'OUT', '-24', '250'],
      [world.materials.salt.id, 'OUT', '-1', '40'],
    ])

    // Costs: ₱6,040 planned and actual; ÷ 18 kg; variance = 6040 − 6040/20 × 18 = ₱604 over plan.
    expect(run.plannedCost?.toString()).toBe('6040')
    expect(run.actualCost?.toString()).toBe('6040')
    expect(places(run.costPerUnit, 4)).toBe('335.5556')
    expect(places(run.costVariance, 6)).toBe('604')

    // The yield arrives as one lot, numbered after the order, aging from when the kitchen reported it.
    const lot = await prisma.finishedGoodLot.findUniqueOrThrow({ where: { productionOrderId: order.id }, include: { movements: true } })
    expect(lot.lotNumber).toBe(run.orderNumber)
    expect(await lotQuantity(lot.id, kitchen)).toBe('18')
    expect(lot.expiresAt!.getTime() - run.completedAt!.getTime()).toBe(48 * HOUR)
    expect(lot.movements.map(m => [m.type, m.quantity.toString(), places(m.unitCost, 4)])).toEqual([['IN', '18', '335.5556']])
  })

  it('moves nothing until accounting signs the completion off', async () => {
    const order = await reportedRun(world, '10')

    expect((await prisma.productionOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PENDING_COMPLETION')
    expect(await prisma.stockMovement.count()).toBe(0)
    expect(await prisma.finishedGoodLot.count()).toBe(0)
  })

  it('lets stock go negative rather than block a run the kitchen already cooked', async () => {
    await completedRun(world, '10')
    expect(await stockOf(world.materials.pork.id, kitchen)).toBe('-12')
  })

  it('asks KitchenAI to explain the cost once it is recorded, on the AI queue', async () => {
    const order = await completedRun(world, '10')
    const jobs = await getAiQueue().getJobs(['waiting', 'delayed', 'prioritized'])
    expect(jobs.map(job => [job.name, job.data.productionOrderId])).toContainEqual(['cost-variance-explain', order.id])
  })

  it('sends a rejected completion back to the kitchen, with nothing moved, to report again', async () => {
    const order = await reportedRun(world, '10')

    ok(await ProductionOrderService.applyCompletionDecision(order.id, as(world.users.accounting), 'REJECTED', 'Yield looks too high — weigh again'))
    const run = await prisma.productionOrder.findUniqueOrThrow({ where: { id: order.id } })
    expect([run.status, run.actualQty, run.completedAt]).toEqual(['IN_PROGRESS', null, null])
    expect(await prisma.stockMovement.count()).toBe(0)

    ok(await ProductionOrderService.complete(order.id, as(world.users.production), '9.5'))
    ok(await ProductionOrderService.applyCompletionDecision(order.id, as(world.users.accounting), 'APPROVED', null))
    expect(await prisma.finishedGoodLevel.findFirstOrThrow()).toMatchObject({ quantity: new Prisma.Decimal('9.5') })
  })

  it('signs a completion off only once', async () => {
    const order = await completedRun(world, '10')

    const again = await ProductionOrderService.applyCompletionDecision(order.id, as(world.users.accounting2), 'APPROVED', null)
    expect(again).toMatchObject({ success: false, status: 409 })
    expect(await stockOf(world.materials.pork.id, kitchen)).toBe('-12')
    expect(await prisma.finishedGoodLot.count()).toBe(1)
  })

  it('refuses to sign off without a shelf life, or without a price — and moves nothing', async () => {
    const noShelfLife = await reportedRun(world, '10')
    await prisma.finishedGood.update({ where: { id: world.finishedGoods.lechon.id }, data: { shelfLifeHours: null } })
    expect(await ProductionOrderService.applyCompletionDecision(noShelfLife.id, as(world.users.accounting), 'APPROVED', null))
      .toMatchObject({ success: false, status: 409, error: expect.stringContaining('has no shelf life') })

    await prisma.finishedGood.update({ where: { id: world.finishedGoods.lechon.id }, data: { shelfLifeHours: 48 } })
    await prisma.itemPrice.deleteMany({ where: { materialId: world.materials.salt.id } })
    expect(await ProductionOrderService.applyCompletionDecision(noShelfLife.id, as(world.users.accounting), 'APPROVED', null))
      .toMatchObject({ success: false, status: 409, error: expect.stringContaining('No reference price for Rock Salt') })

    expect(await prisma.stockMovement.count()).toBe(0)
    expect(await prisma.finishedGoodLot.count()).toBe(0)
  })
})

describe('planning a run', () => {
  const plan = (overrides: Record<string, unknown> = {}) => ({
    finishedGoodId: world.finishedGoods.lechon.id, batchWeight: '10', batchCount: 1,
    plannedDate: todayIsoDate(), branchId: kitchen, ...overrides,
  })

  it.each([
    ['at an outlet — outlets never cook', () => ({ branchId: world.branches.outlet.id }), 'is an outlet'],
    ['for a past date', () => ({ plannedDate: '2020-01-01' }), 'cannot be in the past'],
    ['with no batches', () => ({ batchCount: 0 }), 'whole number from 1 to 100'],
    ['with too many batches', () => ({ batchCount: 101 }), 'whole number from 1 to 100'],
    ['with a zero batch weight', () => ({ batchWeight: '0' }), 'greater than zero'],
  ])('refuses a run %s', async (_label, overrides, message) => {
    const result = await ProductionOrderService.create(plan(overrides()), as(world.users.production))
    expect(result).toMatchObject({ success: false, status: 400, error: expect.stringContaining(message) })
  })

  it('lets only production plan', async () => {
    for (const user of [world.users.accounting, world.users.procurement, world.users.branchManager]) {
      expect(await ProductionOrderService.create(plan(), as(user))).toMatchObject({ success: false, status: 403 })
    }
  })

  it('refuses a yield of nothing, or more than twice the plan', async () => {
    const order = await submittedRun(world)
    ok(await ProductionOrderService.applyDecision(order.id, as(world.users.accounting), 'APPROVED', null))
    ok(await ProductionOrderService.start(order.id, as(world.users.production)))

    expect(await ProductionOrderService.complete(order.id, as(world.users.production), '0')).toMatchObject({ success: false, status: 400 })
    expect(await ProductionOrderService.complete(order.id, as(world.users.production), '20.01')).toMatchObject({ success: false, status: 400 })
    expect(await ProductionOrderService.complete(order.id, as(world.users.production), '20')).toMatchObject({ success: true })
  })
})

describe('nobody approves their own production work, ADMIN included', () => {
  it('refuses whoever submitted the order deciding it', async () => {
    const order = await submittedRun(world, 1, world.users.admin)
    expect(await ProductionOrderService.applyDecision(order.id, as(world.users.admin), 'APPROVED', null)).toMatchObject({ success: false, status: 403 })
  })

  it('refuses whoever reported the run done signing it off', async () => {
    const order = await reportedRun(world, '10', 1, world.users.admin)
    expect(await ProductionOrderService.applyCompletionDecision(order.id, as(world.users.admin), 'APPROVED', null)).toMatchObject({ success: false, status: 403 })
    expect(await prisma.finishedGoodLot.count()).toBe(0)
  })
})

// ─── Conversion (Lechon → Lechon Paksiw) ─────────────────────────────────────

describe('a conversion', () => {
  // Three Lechon lots at the kitchen: 3 kg expiring soon, 10 kg later, 4 kg already expired.
  let soon: { id: string }, later: { id: string }, expired: { id: string }
  beforeEach(async () => {
    soon    = await lechonLot(world, '3', 10)
    later   = await lechonLot(world, '10', 40)
    expired = await lechonLot(world, '4', -1)
  })

  const record = (sourceQty: string, outputQty: string, by = world.users.production, branchId = kitchen) =>
    ConversionOrderService.create({ bomId: world.boms.paksiw.id, branchId, sourceQty, outputQty }, as(by))

  it('takes the source soonest-expiry first, never an expired lot, and adds a costed Paksiw lot', async () => {
    const conversion = ok(await record('5', '5.5'))
    ok(await ConversionOrderService.applyDecision(conversion.id, as(world.users.accounting), 'APPROVED', null))

    // 5 kg: all 3 kg of the soonest lot, then 2 kg of the next. The expired lot is untouched.
    expect([await lotQuantity(soon.id, kitchen), await lotQuantity(later.id, kitchen), await lotQuantity(expired.id, kitchen)]).toEqual(['0', '8', '4'])
    const taken = await prisma.finishedGoodMovement.findMany({ where: { referenceType: 'ConversionOrder', referenceId: conversion.id, type: 'OUT' } })
    expect(taken.map(m => [m.lotId, m.quantity.toString()]).sort()).toEqual([[later.id, '-2'], [soon.id, '-3']].sort())

    // Added salt: 0.25 kg × 5 ÷ 5 = 0.25 kg at ₱40.
    const salt = await prisma.stockMovement.findFirstOrThrow({ where: { referenceType: 'ConversionOrder', referenceId: conversion.id } })
    expect([salt.materialId, salt.quantity.toString(), salt.unitCost?.toString()]).toEqual([world.materials.salt.id, '-0.25', '40'])

    // Cost: the lots' own costs (3 × 3020/3 + 2 × 3020/10 = ₱3,624) + ₱10 salt, ÷ 5.5 kg.
    const order = await prisma.conversionOrder.findUniqueOrThrow({ where: { id: conversion.id }, include: { lot: true } })
    expect(order.status).toBe('APPROVED')
    expect(places(order.sourceCost, 2)).toBe('3624')
    expect(order.conversionCost?.toString()).toBe('10')
    expect(places(order.costPerUnit, 4)).toBe('660.7273')

    // The Paksiw lot: 5.5 kg, 24 h from when the conversion was recorded.
    expect(await lotQuantity(order.lot!.id, kitchen)).toBe('5.5')
    expect(order.lot!.expiresAt!.getTime() - order.createdAt.getTime()).toBe(24 * HOUR)
  })

  it('counts only unexpired Lechon as available', async () => {
    expect(await record('14', '15')).toMatchObject({ success: false, status: 400, error: expect.stringContaining('Only 13 kg of unexpired Lechon') })
  })

  it('counts what pending conversions already claim', async () => {
    ok(await record('10', '12'))
    expect(await record('4', '4.8')).toMatchObject({ success: false, status: 400, error: expect.stringContaining('Only 3 kg') })
  })

  it('refuses an output more than twice what the recipe makes', async () => {
    // 5 kg Lechon should make 6 kg Paksiw; at most 12.
    expect(await record('5', '12.01')).toMatchObject({ success: false, status: 400 })
  })

  it('is done at a kitchen, by production, and decided by someone else', async () => {
    expect(await record('5', '6', world.users.production, world.branches.outlet.id)).toMatchObject({ success: false, status: 400, error: expect.stringContaining('is an outlet') })
    expect(await record('5', '6', world.users.accounting)).toMatchObject({ success: false, status: 403 })

    const own = ok(await record('5', '6', world.users.admin))
    expect(await ConversionOrderService.applyDecision(own.id, as(world.users.admin), 'APPROVED', null)).toMatchObject({ success: false, status: 403 })
  })

  it('re-checks the lots at approval: if they expired meanwhile, it refuses and moves nothing', async () => {
    const conversion = ok(await record('12', '14'))
    // The soonest lot expires before accounting gets to it: 10 kg unexpired left, 12 needed.
    await prisma.finishedGoodLot.update({ where: { id: soon.id }, data: { expiresAt: new Date(Date.now() - 1000) } })

    const result = await ConversionOrderService.applyDecision(conversion.id, as(world.users.accounting), 'APPROVED', null)
    expect(result).toMatchObject({ success: false, status: 409, error: expect.stringContaining('Only 10 kg of the 12 kg') })
    expect([await lotQuantity(soon.id, kitchen), await lotQuantity(later.id, kitchen)]).toEqual(['3', '10'])
    expect((await prisma.conversionOrder.findUniqueOrThrow({ where: { id: conversion.id } })).status).toBe('PENDING_APPROVAL')
  })
})

// ─── Write-off ───────────────────────────────────────────────────────────────

describe('a write-off', () => {
  let lot: { id: string }
  beforeEach(async () => {
    lot = await lechonLot(world, '4', -1) // 4 kg, expired an hour ago: the usual write-off
  })

  const record = (quantity: string, reason: 'EXPIRED' | 'SPOILED' | 'OTHER' = 'EXPIRED', notes: string | null = null, by = world.users.production, lotId = lot.id) =>
    WriteOffService.create({ lotId, branchId: kitchen, quantity, reason, notes }, as(by))

  it('takes the quantity out of the lot as WASTE, at the lot’s cost', async () => {
    const writeOff = ok(await record('4'))
    ok(await WriteOffService.applyDecision(writeOff.id, as(world.users.accounting), 'APPROVED', null))

    expect(await lotQuantity(lot.id, kitchen)).toBe('0')
    const waste = await prisma.finishedGoodMovement.findFirstOrThrow({ where: { referenceType: 'WriteOff', referenceId: writeOff.id } })
    expect([waste.type, waste.quantity.toString(), waste.unitCost?.toString()]).toEqual(['WASTE', '-4', '755'])
    const row = await prisma.writeOff.findUniqueOrThrow({ where: { id: writeOff.id } })
    expect([row.status, row.unitCost?.toString(), row.totalCost?.toString()]).toEqual(['APPROVED', '755', '3020'])
  })

  it('cannot write off more than the lot has left, counting pending write-offs', async () => {
    expect(await record('4.5')).toMatchObject({ success: false, status: 400 })
    ok(await record('3'))
    expect(await record('2')).toMatchObject({ success: false, status: 400, error: expect.stringContaining('only 1 kg left') })
  })

  it('needs notes when the reason is Other', async () => {
    expect(await record('1', 'OTHER')).toMatchObject({ success: false, status: 400 })
    expect(await record('1', 'OTHER', 'Dropped on the floor')).toMatchObject({ success: true })
  })

  it('is decided by someone else, with a reason to reject; a rejection moves nothing and frees the lot', async () => {
    const own = ok(await record('4', 'EXPIRED', null, world.users.admin))
    expect(await WriteOffService.applyDecision(own.id, as(world.users.admin), 'APPROVED', null)).toMatchObject({ success: false, status: 403 })
    expect(await WriteOffService.applyDecision(own.id, as(world.users.accounting), 'REJECTED', ' ')).toMatchObject({ success: false, status: 400 })

    ok(await WriteOffService.applyDecision(own.id, as(world.users.accounting), 'REJECTED', 'Wrong lot'))
    expect(await lotQuantity(lot.id, kitchen)).toBe('4')
    expect(await record('4')).toMatchObject({ success: true })
  })

  it('lets only production record one', async () => {
    expect(await record('1', 'EXPIRED', null, world.users.accounting)).toMatchObject({ success: false, status: 403 })
  })
})

// ─── Conversion and write-off on the same Lechon ─────────────────────────────

describe('a lot waiting to be written off', () => {
  it('is not used as the source of a conversion', async () => {
    // A 3 kg lot found spoiled before it expired, and a 10 kg good lot.
    const spoiled = await lechonLot(world, '3', 10)
    const good    = await lechonLot(world, '10', 40)
    const writeOff = ok(await WriteOffService.create(
      { lotId: spoiled.id, branchId: kitchen, quantity: '3', reason: 'SPOILED', notes: 'Smelled off at opening' }, as(world.users.production),
    ))

    // The conversion is allowed: 13 kg unexpired, 3 kg claimed by the write-off, 10 kg available.
    const conversion = ok(await ConversionOrderService.create(
      { bomId: world.boms.paksiw.id, branchId: kitchen, sourceQty: '5', outputQty: '6' }, as(world.users.production),
    ))
    ok(await ConversionOrderService.applyDecision(conversion.id, as(world.users.accounting), 'APPROVED', null))

    // Spoiled Lechon must not become Paksiw: the 5 kg comes from the good lot,
    // and the write-off can still be approved.
    expect(await lotQuantity(spoiled.id, kitchen)).toBe('3')
    expect(await lotQuantity(good.id, kitchen)).toBe('5')
    expect(await WriteOffService.applyDecision(writeOff.id, as(world.users.accounting), 'APPROVED', null)).toMatchObject({ success: true })
  })

  it('is not sent to an outlet', async () => {
    const spoiled = await lechonLot(world, '3', 10)
    const good    = await lechonLot(world, '10', 40)
    const writeOff = ok(await WriteOffService.create(
      { lotId: spoiled.id, branchId: kitchen, quantity: '3', reason: 'DAMAGED', notes: 'Tray dropped' }, as(world.users.production),
    ))

    const transfer = ok(await StockTransferService.create(
      { fromBranchId: kitchen, toBranchId: world.branches.outlet.id, lines: [{ finishedGoodId: world.finishedGoods.lechon.id, quantity: '5' }] },
      as(world.users.production),
    ))
    ok(await StockTransferService.applyDecision(transfer.id, as(world.users.accounting), 'APPROVED', null))

    const sent = await prisma.finishedGoodMovement.findMany({ where: { referenceType: 'StockTransfer', referenceId: transfer.id } })
    expect(sent.map(m => [m.lotId, m.quantity.toString()])).toEqual([[good.id, '-5']])
    expect(await lotQuantity(spoiled.id, kitchen)).toBe('3')
    expect(await WriteOffService.applyDecision(writeOff.id, as(world.users.accounting), 'APPROVED', null)).toMatchObject({ success: true })
  })

  it('still lets a conversion use what the write-off does not claim', async () => {
    // 3 kg lot, 1 kg of it claimed: the other 2 kg are fine to use, soonest-expiry first.
    const partly = await lechonLot(world, '3', 10)
    const good   = await lechonLot(world, '10', 40)
    ok(await WriteOffService.create({ lotId: partly.id, branchId: kitchen, quantity: '1', reason: 'DAMAGED', notes: 'Edge burnt' }, as(world.users.production)))

    const conversion = ok(await ConversionOrderService.create({ bomId: world.boms.paksiw.id, branchId: kitchen, sourceQty: '5', outputQty: '6' }, as(world.users.production)))
    ok(await ConversionOrderService.applyDecision(conversion.id, as(world.users.accounting), 'APPROVED', null))

    expect([await lotQuantity(partly.id, kitchen), await lotQuantity(good.id, kitchen)]).toEqual(['1', '7'])
  })
})
