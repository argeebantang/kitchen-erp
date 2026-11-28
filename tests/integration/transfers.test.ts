import { BranchType, Role } from '@prisma/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { addDays, todayIsoDate } from '@/lib/dates'
import { StockTransferService } from '@/services/stock-transfer.service'
import { StockRequestService } from '@/services/stock-request.service'
import { createWorld, type World } from '../helpers/fixtures'
import { as, ok } from '../helpers/procurement'
import { lechonLot, lotQuantity } from '../helpers/production'

/**
 * Transfers (kitchen → outlet, approved by accounting, counted by the outlet),
 * returns (outlet → kitchen, no approval) and stock requests (the outlet asks,
 * the kitchen plans and sends), through the services against a real database.
 *
 * Every test starts with one 10 kg Lechon lot at Main Kitchen, cooked for
 * ₱3,020 (₱302/kg) and expiring in 40 h. Cubao Outlet is run by the branch
 * manager.
 */

let world: World
let kitchen: string
let outlet: string
let lot: { id: string }

beforeEach(async () => {
  world = await createWorld()
  kitchen = world.branches.kitchen.id
  outlet = world.branches.outlet.id
  lot = await lechonLot(world, '10', 40)
})

const lechon = (quantity: string) => [{ finishedGoodId: world.finishedGoods.lechon.id, quantity }]
const send = (quantity: string, by = world.users.production, extra: { stockRequestId?: string; fromBranchId?: string } = {}) =>
  StockTransferService.create({ fromBranchId: extra.fromBranchId ?? kitchen, toBranchId: outlet, stockRequestId: extra.stockRequestId, lines: lechon(quantity) }, as(by))

/** A delivery recorded and approved: on its way to the outlet. */
async function inTransit(quantity: string) {
  const transfer = ok(await send(quantity))
  ok(await StockTransferService.applyDecision(transfer.id, as(world.users.accounting), 'APPROVED', null))
  return transfer
}

const count = (received: string, reason: 'DAMAGED' | 'SPOILED' | 'MISSING' | 'OTHER' | null = null, notes: string | null = null) =>
  ({ lots: [{ lotId: lot.id, received }], reason, notes })

describe('a delivery to an outlet', () => {
  it('leaves the kitchen on approval and joins the outlet when counted, as the same lot', async () => {
    const transfer = ok(await send('6'))
    expect(await lotQuantity(lot.id, kitchen)).toBe('10') // nothing moves before approval

    ok(await StockTransferService.applyDecision(transfer.id, as(world.users.accounting), 'APPROVED', null))
    expect(await lotQuantity(lot.id, kitchen)).toBe('4')
    expect(await lotQuantity(lot.id, outlet)).toBe('0') // in transit

    const received = ok(await StockTransferService.receive(transfer.id, as(world.users.branchManager), count('6')))
    expect(received).toMatchObject({ status: 'RECEIVED', varianceValue: '0' })
    expect(await lotQuantity(lot.id, outlet)).toBe('6')

    const movements = await prisma.finishedGoodMovement.findMany({ where: { referenceType: 'StockTransfer', referenceId: transfer.id }, orderBy: { quantity: 'asc' } })
    expect(movements.map(m => [m.branchId, m.type, m.quantity.toString(), m.unitCost?.toString()])).toEqual([
      [kitchen, 'TRANSFER', '-6', '302'],
      [outlet, 'TRANSFER', '6', '302'],
    ])
  })

  it('records what arrived short, why, and what it was worth', async () => {
    const transfer = await inTransit('6')

    expect(await StockTransferService.receive(transfer.id, as(world.users.branchManager), count('5')))
      .toMatchObject({ success: false, status: 400, error: 'Something arrived short — choose why' })

    const received = ok(await StockTransferService.receive(transfer.id, as(world.users.branchManager), count('5', 'DAMAGED', 'Box crushed')))
    expect(received.varianceValue).toBe('302') // 1 kg × ₱302
    expect(await lotQuantity(lot.id, outlet)).toBe('5')
    expect(await prisma.stockTransfer.findUniqueOrThrow({ where: { id: transfer.id } })).toMatchObject({ varianceReason: 'DAMAGED', varianceNotes: 'Box crushed' })
  })

  it.each([
    ['more than was sent', () => count('7'), 'a dispatch miscount'],
    ['a short count with reason Other and no note', () => count('5', 'OTHER'), 'Say what happened'],
    ['no count for a lot that was sent', () => ({ lots: [], reason: null, notes: null }), 'Count every lot that was sent'],
  ])('refuses a receipt with %s', async (_label, receipt, message) => {
    const transfer = await inTransit('6')
    expect(await StockTransferService.receive(transfer.id, as(world.users.branchManager), receipt()))
      .toMatchObject({ success: false, status: 400, error: expect.stringContaining(message) })
    expect(await lotQuantity(lot.id, outlet)).toBe('0')
  })

  it('is counted by that outlet’s manager or an admin — no one else', async () => {
    const transfer = await inTransit('6')

    // Production can see it but cannot confirm another branch's delivery.
    expect(await StockTransferService.receive(transfer.id, as(world.users.production), count('6'))).toMatchObject({ success: false, status: 403 })

    // The manager of another outlet does not even see it.
    const other = await prisma.user.create({ data: { email: 'other-manager@test.local', name: 'Other', passwordHash: 'x', role: Role.BRANCH_MANAGER } })
    await prisma.branch.create({ data: { name: 'Makati Outlet', code: 'MKT', type: BranchType.OUTLET, managerId: other.id } })
    expect(await StockTransferService.receive(transfer.id, as(other), count('6'))).toMatchObject({ success: false, status: 404 })

    ok(await StockTransferService.receive(transfer.id, as(world.users.admin), count('6')))
  })

  it('cannot be counted before approval, or twice', async () => {
    const pending = ok(await send('3'))
    expect(await StockTransferService.receive(pending.id, as(world.users.branchManager), count('3')))
      .toMatchObject({ success: false, status: 409, error: expect.stringContaining('still waiting for accounting') })

    ok(await StockTransferService.applyDecision(pending.id, as(world.users.accounting), 'APPROVED', null))
    ok(await StockTransferService.receive(pending.id, as(world.users.branchManager), count('3')))
    expect(await StockTransferService.receive(pending.id, as(world.users.branchManager), count('3'))).toMatchObject({ success: false, status: 409 })
    expect(await lotQuantity(lot.id, outlet)).toBe('3')
  })

  it('is sent from a kitchen only, within what it has, and decided by someone else', async () => {
    expect(await send('6', world.users.production, { fromBranchId: outlet })).toMatchObject({ success: false, status: 400 })
    expect(await send('10.5')).toMatchObject({ success: false, status: 409, error: expect.stringContaining('Not enough at Main Kitchen') })

    const own = ok(await send('6', world.users.admin))
    expect(await StockTransferService.applyDecision(own.id, as(world.users.admin), 'APPROVED', null)).toMatchObject({ success: false, status: 403 })
    expect(await StockTransferService.applyDecision(own.id, as(world.users.accounting), 'REJECTED', '')).toMatchObject({ success: false, status: 400 })

    ok(await StockTransferService.applyDecision(own.id, as(world.users.accounting), 'REJECTED', 'Outlet is closed tomorrow'))
    expect(await lotQuantity(lot.id, kitchen)).toBe('10')
    expect(await prisma.finishedGoodMovement.count({ where: { referenceType: 'StockTransfer' } })).toBe(0)
  })

  it('counts what other pending transfers already promise', async () => {
    ok(await send('7'))
    expect(await send('4')).toMatchObject({ success: false, status: 409, error: expect.stringContaining('3 kg available') })
    expect(await send('3')).toMatchObject({ success: true })
  })
})

describe('a return from an outlet', () => {
  it('leaves the outlet at once, with no approval, and joins the kitchen when production counts it', async () => {
    const delivery = await inTransit('6')
    ok(await StockTransferService.receive(delivery.id, as(world.users.branchManager), count('6')))

    const back = ok(await StockTransferService.createReturn(
      { fromBranchId: outlet, toBranchId: kitchen, lines: lechon('2'), notes: 'Unsold at closing' }, as(world.users.branchManager),
    ))
    expect(await lotQuantity(lot.id, outlet)).toBe('4')
    expect((await prisma.stockTransfer.findUniqueOrThrow({ where: { id: back.id } })).status).toBe('APPROVED') // "in transit"

    // A return needs no approval: accounting cannot decide it.
    expect(await StockTransferService.applyDecision(back.id, as(world.users.accounting), 'APPROVED', null)).toMatchObject({ success: false, status: 409 })

    ok(await StockTransferService.receive(back.id, as(world.users.production), count('2')))
    expect(await lotQuantity(lot.id, kitchen)).toBe('6') // 4 left + 2 back
  })

  it('is sent by that outlet’s manager, from an outlet, to a kitchen', async () => {
    const input = { fromBranchId: outlet, toBranchId: kitchen, lines: lechon('1') }
    expect(await StockTransferService.createReturn(input, as(world.users.production))).toMatchObject({ success: false, status: 403 })
    expect(await StockTransferService.createReturn({ ...input, fromBranchId: kitchen }, as(world.users.admin))).toMatchObject({ success: false, status: 400 })
    // Nothing at the outlet yet: refused, nothing written.
    expect(await StockTransferService.createReturn(input, as(world.users.branchManager))).toMatchObject({ success: false })
    expect(await prisma.stockTransfer.count()).toBe(0)
  })
})

describe('a stock request', () => {
  const tomorrow = () => addDays(todayIsoDate(), 1)
  const ask = (quantity: string, by = world.users.branchManager) =>
    StockRequestService.create({ branchId: outlet, kitchenId: kitchen, neededOn: tomorrow(), lines: lechon(quantity) }, as(by))

  async function planned(quantity: string) {
    const request = ok(await ask(quantity))
    const [item] = await prisma.stockRequestItem.findMany({ where: { stockRequestId: request.id } })
    ok(await StockRequestService.plan(request.id, as(world.users.production), { lines: [{ itemId: item.id, plannedQuantity: quantity }] }))
    return request
  }

  it('is fulfilled when the delivery sent for it is counted in full', async () => {
    const request = await planned('5')
    const transfer = ok(await send('5', world.users.production, { stockRequestId: request.id }))
    ok(await StockTransferService.applyDecision(transfer.id, as(world.users.accounting), 'APPROVED', null))
    ok(await StockTransferService.receive(transfer.id, as(world.users.branchManager), count('5')))

    expect((await prisma.stockRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('FULFILLED')
  })

  it('is partly fulfilled when the delivery arrives short', async () => {
    const request = await planned('5')
    const transfer = ok(await send('5', world.users.production, { stockRequestId: request.id }))
    ok(await StockTransferService.applyDecision(transfer.id, as(world.users.accounting), 'APPROVED', null))
    ok(await StockTransferService.receive(transfer.id, as(world.users.branchManager), count('4', 'MISSING')))

    expect((await prisma.stockRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('PARTLY_FULFILLED')
  })

  it('is sent on one delivery at a time, and only once planned', async () => {
    const unplanned = ok(await ask('2'))
    expect(await send('2', world.users.production, { stockRequestId: unplanned.id })).toMatchObject({ success: false, status: 409 })

    const request = await planned('3')
    ok(await send('3', world.users.production, { stockRequestId: request.id }))
    expect(await send('3', world.users.production, { stockRequestId: request.id })).toMatchObject({ success: false, status: 409 })
  })

  it('is asked by the outlet’s own manager, and answered by the kitchen — a decline needs a reason', async () => {
    expect(await ask('2', world.users.production)).toMatchObject({ success: false, status: 403 })

    const request = ok(await ask('2'))
    expect(await StockRequestService.decline(request.id, as(world.users.branchManager), 'No')).toMatchObject({ success: false, status: 403 })
    expect(await StockRequestService.decline(request.id, as(world.users.production), '  ')).toMatchObject({ success: false, status: 400 })
    ok(await StockRequestService.decline(request.id, as(world.users.production), 'Oven down tomorrow'))
    expect((await prisma.stockRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('DECLINED')
  })

  it('cannot plan more than was asked', async () => {
    const request = ok(await ask('2'))
    const [item] = await prisma.stockRequestItem.findMany({ where: { stockRequestId: request.id } })
    expect(await StockRequestService.plan(request.id, as(world.users.production), { lines: [{ itemId: item.id, plannedQuantity: '2.5' }] }))
      .toMatchObject({ success: false, status: 400 })
  })
})
