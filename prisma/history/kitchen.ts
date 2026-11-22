import { MovementType, Prisma, ProductionStatus, StockRequestStatus, TransferKind, TransferStatus, TransferVarianceReason } from '@prisma/client'
import { addDays, isoDateAt } from '@/lib/dates'
import { prisma } from '@/lib/prisma'
import { FinishedGoodStockRepository } from '@/repositories/finished-good-stock.repository'
import { InventoryRepository } from '@/repositories/inventory.repository'
import { at, dateOnly } from './calendar'
import { HOME_KITCHEN, type GoodCode } from './demand'
import {
  addStock, count, decimal, listOf, moveLot, nextNumber, planTakes, sellable, stockKey, type OpenRequest, type ScheduledRun, type World,
} from './world'

/**
 * The kitchens' side of the history (subtask 1.4), on the app's own flows:
 *   - evening: plan tomorrow's requests (cut, with a reason, when the stock on
 *     hand cannot cover them; now and then declined), then schedule the runs —
 *     production orders drafted, submitted and approved
 *   - morning: cook — started, reported done with the real yield, completion
 *     approved by accounting: ingredients out at the day's reference prices,
 *     a costed lot in
 *   - late morning: deliver each planned request — a transfer recorded,
 *     approved (dispatched, soonest-expiry lots first) and received by the
 *     outlet, which fulfils the request
 *
 * Runs are planned from ingredients already on hand, never from deliveries
 * still due, so a kitchen's stock never goes below zero.
 *
 * Built-in patterns:
 *   - Las Piñas Commissary's Bopis yields less (88–94 % instead of 95–102 %)
 *   - the Pasig Commissary → Makati Outlet route loses goods in transit (~20 % of deliveries)
 */

/** Cook a little more than asked, to cover yield. */
const COOK_BUFFER = 1.05
/** The yield the planner counts on. */
const PLANNED_YIELD = 0.97
const DECLINE_CHANCE = 0.015
const DECLINE_REASONS = [
  'No vehicle for that route tomorrow — please ask another kitchen',
  'Kitchen closed for the gas line repair',
  'Roaster down for maintenance',
]
/** Which goods get the ingredients first when they run short: the best seller first. */
const PRIORITY: GoodCode[] = ['FG-LECHON', 'FG-DINUGUAN', 'FG-BOPIS', 'FG-LECHON-PAKSIW']

function yieldFor(world: World, kitchenCode: string, good: GoodCode): number {
  const { random } = world
  if (kitchenCode === 'LPS' && good === 'FG-BOPIS') return random.between(0.88, 0.94)
  if (good === 'FG-LECHON') return random.between(0.92, 1.0)
  return random.between(0.95, 1.02)
}

const floorHalf = (value: number) => Math.floor(value * 2 + 1e-9) / 2

/** In the evening of `date`, each kitchen plans `date` + 1: answers the requests, then schedules the runs. */
export async function planTomorrow(world: World, date: string): Promise<void> {
  const tomorrow = addDays(date, 1)
  for (const kitchen of world.cast.kitchens) {
    const requests = world.requests.filter(r => r.kitchenId === kitchen.id && r.neededOn === tomorrow && r.status === 'SUBMITTED')
    if (requests.length === 0) continue
    const decidedAt = () => at(date, '16:00', world.random.int(0, 150))

    for (const request of requests) {
      if (world.random.chance(DECLINE_CHANCE)) await decline(world, request, decidedAt())
    }
    const open = requests.filter(r => r.status === 'SUBMITTED')

    // What tomorrow needs per good, and what the kitchen can cover from stock and cooking.
    const ingredients = new Map([...world.onHand].filter(([key]) => key.startsWith(`${kitchen.id}:`)))
    const runs: { good: GoodCode; batches: number }[] = []
    const supply = new Map<GoodCode, number>()
    const shortOf = new Map<GoodCode, string>()
    for (const good of PRIORITY) {
      const asked = open.flatMap(r => r.lines).filter(l => l.good === good).reduce((sum, l) => sum + l.asked, 0)
      if (asked === 0) continue
      const recipe   = world.goods.get(good)!
      const size     = recipe.batchSize.toNumber()
      const onShelf  = sellable(world, kitchen.id, good, at(tomorrow, '11:00'))
        + (good === world.conversion.output ? convertibleTomorrow(world, kitchen, tomorrow) : 0)
      const wanted   = Math.max(0, Math.ceil((asked * COOK_BUFFER - onShelf) / (size * PLANNED_YIELD)))
      let batches    = wanted
      for (const line of recipe.bomLines) {
        const perBatch = line.quantity.toNumber()
        const have = ingredients.get(stockKey(kitchen.id, line.materialId)) ?? 0
        const possible = Math.floor((have + 1e-9) / perBatch)
        if (possible < batches) {
          batches = possible
          shortOf.set(good, world.materialById.get(line.materialId)?.name ?? 'an ingredient')
        }
      }
      for (const line of recipe.bomLines) {
        const key = stockKey(kitchen.id, line.materialId)
        ingredients.set(key, (ingredients.get(key) ?? 0) - line.quantity.toNumber() * batches)
      }
      if (batches > 0) runs.push({ good, batches })
      supply.set(good, onShelf + batches * size * PLANNED_YIELD)
    }

    for (const request of open) await plan(world, request, supply, shortOf, decidedAt())
    for (const run of runs) await schedule(world, kitchen.id, tomorrow, run.good, run.batches, date)
  }
}

/** Returns tonight are about half of what an outlet holds that will not last: the rest sells today. */
const RETURN_ESTIMATE = 0.5

/**
 * The Paksiw tomorrow morning's conversion should make (waste.ts): the
 * kitchen's Lechon that expires within a day of the morning, plus an estimate
 * of what its outlets send back tonight. Planning counts it, so the kitchen
 * cooks that much less Paksiw from bought roasted pork.
 */
function convertibleTomorrow(world: World, kitchen: { id: string; code: string }, tomorrow: string): number {
  const { conversion } = world
  const morning = at(tomorrow, '07:45')
  const horizon = new Date(at(tomorrow, '07:00').getTime() + 24 * 3_600_000)
  const outlets = world.cast.outlets.filter(o => HOME_KITCHEN[o.code] === kitchen.code).map(o => o.id)
  let lechon = 0
  for (const lot of world.lots) {
    if (lot.good !== conversion.source || lot.expiresAt <= morning || lot.expiresAt > horizon) continue
    lechon += lot.at.get(kitchen.id) ?? 0
    for (const outlet of outlets) lechon += (lot.at.get(outlet) ?? 0) * RETURN_ESTIMATE
  }
  return lechon * conversion.batchSize.div(conversion.sourceQuantity).toNumber() * PLANNED_YIELD
}

async function decline(world: World, request: OpenRequest, decidedAt: Date) {
  const note = world.random.pick(DECLINE_REASONS)
  await prisma.stockRequest.update({
    where: { id: request.id },
    data:  { status: StockRequestStatus.DECLINED, decidedById: world.cast.staff.production, decidedAt, kitchenNote: note, updatedAt: decidedAt },
  })
  request.status = 'DECLINED'
  count(world, 'stock requests declined')
}

/** Each line gets its share of what the kitchen can cover; a cut says why. */
async function plan(world: World, request: OpenRequest, supply: Map<GoodCode, number>, shortOf: Map<GoodCode, string>, decidedAt: Date) {
  const cuts: string[] = []
  for (const line of request.lines) {
    const total = world.requests
      .filter(r => r.kitchenId === request.kitchenId && r.neededOn === request.neededOn && r.status !== 'DECLINED')
      .flatMap(r => r.lines).filter(l => l.good === line.good).reduce((sum, l) => sum + l.asked, 0)
    const share = total === 0 ? 0 : Math.min(1, (supply.get(line.good) ?? 0) / total)
    line.planned = share >= 1 ? line.asked : floorHalf(line.asked * share)
    if (line.planned < line.asked) cuts.push(shortOf.get(line.good) ?? world.goods.get(line.good)!.name)
  }
  const kitchenNote = cuts.length > 0 ? `Short on ${listOf([...new Set(cuts)])} — sending what we can` : null
  await prisma.$transaction(async tx => {
    for (const line of request.lines) {
      await tx.stockRequestItem.updateMany({
        where: { stockRequestId: request.id, finishedGoodId: world.goods.get(line.good)!.id },
        data:  { plannedQuantity: decimal(line.planned) },
      })
    }
    await tx.stockRequest.update({
      where: { id: request.id },
      data:  { status: StockRequestStatus.PLANNED, decidedById: world.cast.staff.production, decidedAt, kitchenNote, updatedAt: decidedAt },
    })
  })
  request.status = 'PLANNED'
  if (cuts.length > 0) count(world, 'stock requests cut')
}

/** A production order for `day`, drafted, submitted and approved on the evening of `evening`. */
async function schedule(world: World, kitchenId: string, day: string, good: GoodCode, batches: number, evening: string) {
  const { cast, random } = world
  const recipe      = world.goods.get(good)!
  const createdAt   = at(evening, '18:30', random.int(0, 20))
  const submittedAt = new Date(createdAt.getTime() + 5 * 60_000)
  const approvedAt  = at(evening, '19:00', random.int(0, 60))
  const plannedQty  = recipe.batchSize.mul(batches)

  const order = await prisma.$transaction(async tx => {
    const orderNumber = await nextNumber(tx, 'prd_number_seq', 'PRD-')
    const row = await tx.productionOrder.create({
      data: {
        orderNumber, finishedGoodId: recipe.id, bomId: recipe.bomId, branchId: kitchenId,
        requestedById: cast.staff.production, submittedById: cast.staff.production,
        status: ProductionStatus.APPROVED, batchWeight: recipe.batchSize, batchCount: batches, plannedQty,
        plannedDate: dateOnly(day), notes: null, createdAt, updatedAt: approvedAt,
      },
      select: { id: true, orderNumber: true },
    })
    await tx.productionStatusChange.createMany({
      data: [
        { productionOrderId: row.id, fromStatus: ProductionStatus.DRAFT, toStatus: ProductionStatus.PENDING_APPROVAL, changedById: cast.staff.production, createdAt: submittedAt },
        { productionOrderId: row.id, fromStatus: ProductionStatus.PENDING_APPROVAL, toStatus: ProductionStatus.APPROVED, changedById: cast.staff.accounting, createdAt: approvedAt },
      ],
    })
    await tx.approval.create({
      data: { referenceType: 'ProductionOrder', referenceId: row.id, approverId: cast.staff.accounting, decision: 'APPROVED', remarks: null, decidedAt: approvedAt },
    })
    return row
  })
  world.scheduled.push({
    id: order.id, number: order.orderNumber, kitchenId, good, date: day, plannedQty, batchCount: batches, batchWeight: recipe.batchSize,
  })
  count(world, 'production orders')
}

/** In the morning, every run scheduled for `date` is cooked and signed off. */
export async function cook(world: World, date: string): Promise<void> {
  const runs = world.scheduled.filter(run => run.date === date)
  world.scheduled = world.scheduled.filter(run => run.date !== date)
  for (const run of runs) await complete(world, run)
}

async function complete(world: World, run: ScheduledRun) {
  const { cast, random, prices } = world
  const kitchen   = cast.kitchens.find(k => k.id === run.kitchenId)!
  const recipe    = world.goods.get(run.good)!
  const startedAt  = at(run.date, '05:00', random.int(0, 30))
  const reportedAt = at(run.date, '08:30', random.int(0, 90))
  const approvedAt = new Date(reportedAt.getTime() + random.int(30, 90) * 60_000)
  const actualQty  = decimal(run.plannedQty.toNumber() * yieldFor(world, kitchen.code, run.good))
  const producedOn = isoDateAt(reportedAt)

  // The recipe at the planned quantity, priced at the reference price of each date (Week 6 Task 3).
  const consumption = recipe.bomLines.map(line => ({ materialId: line.materialId, quantity: line.quantity.mul(run.plannedQty).div(recipe.batchSize) }))
  const priceOn = (materialId: string, date: string) => {
    const price = prices.asOf(materialId, date)
    if (!price) throw new Error(`No reference price for ${world.materialById.get(materialId)?.code} on ${date}`)
    return price
  }
  const plannedOn   = run.date
  const plannedCost = consumption.reduce((sum, line) => sum.add(line.quantity.mul(priceOn(line.materialId, plannedOn))), new Prisma.Decimal(0))
  const actualCost  = consumption.reduce((sum, line) => sum.add(line.quantity.mul(priceOn(line.materialId, producedOn))), new Prisma.Decimal(0))
  const costPerUnit = actualCost.div(actualQty)
  const costVariance = actualCost.sub(plannedCost.div(run.plannedQty).mul(actualQty))
  const expiresAt   = new Date(reportedAt.getTime() + recipe.shelfLifeHours * 3_600_000)

  const lotId = await prisma.$transaction(async tx => {
    await tx.productionOrder.update({
      where: { id: run.id },
      data: {
        status: ProductionStatus.COMPLETED, actualQty, completedAt: reportedAt, completedById: cast.staff.production,
        plannedCost, actualCost, costPerUnit, costVariance, updatedAt: approvedAt,
      },
    })
    await tx.productionStatusChange.createMany({
      data: [
        { productionOrderId: run.id, fromStatus: ProductionStatus.APPROVED, toStatus: ProductionStatus.IN_PROGRESS, changedById: cast.staff.production, createdAt: startedAt },
        { productionOrderId: run.id, fromStatus: ProductionStatus.IN_PROGRESS, toStatus: ProductionStatus.PENDING_COMPLETION, changedById: cast.staff.production, createdAt: reportedAt },
        { productionOrderId: run.id, fromStatus: ProductionStatus.PENDING_COMPLETION, toStatus: ProductionStatus.COMPLETED, changedById: cast.staff.accounting, createdAt: approvedAt },
      ],
    })
    await tx.approval.create({
      data: { referenceType: 'ProductionCompletion', referenceId: run.id, approverId: cast.staff.accounting, decision: 'APPROVED', remarks: null, decidedAt: approvedAt },
    })
    for (const line of [...consumption].sort((a, b) => (a.materialId < b.materialId ? -1 : 1))) {
      if (!line.quantity.greaterThan(0)) continue
      await InventoryRepository.stockOut(tx, {
        materialId: line.materialId, branchId: run.kitchenId, quantity: line.quantity, unitCost: priceOn(line.materialId, producedOn),
        referenceType: 'ProductionOrder', referenceId: run.id, notes: run.number,
      })
    }
    const { lotId } = await FinishedGoodStockRepository.receiveLot(tx, {
      lotNumber: run.number, finishedGoodId: recipe.id, productionOrderId: run.id, producedOn: dateOnly(producedOn), expiresAt,
      branchId: run.kitchenId, quantity: actualQty, unitCost: costPerUnit,
      referenceType: 'ProductionOrder', referenceId: run.id, notes: run.number,
    })
    await tx.stockMovement.updateMany({ where: { referenceType: 'ProductionOrder', referenceId: run.id }, data: { createdAt: approvedAt } })
    await tx.finishedGoodMovement.updateMany({ where: { referenceType: 'ProductionOrder', referenceId: run.id }, data: { createdAt: approvedAt } })
    await tx.finishedGoodLot.update({ where: { id: lotId }, data: { createdAt: approvedAt } })
    return lotId
  })

  for (const line of consumption) addStock(world, run.kitchenId, line.materialId, -line.quantity.toNumber())
  world.lots.push({
    id: lotId, number: run.number, good: run.good, expiresAt, unitCost: costPerUnit,
    at: new Map([[run.kitchenId, actualQty.toNumber()]]),
  })
  count(world, 'production runs completed')
}

/** Late morning: every planned request for `date` goes out and is counted in at the outlet. */
export async function deliver(world: World, date: string): Promise<void> {
  const due = world.requests.filter(r => r.neededOn === date && r.status === 'PLANNED')
  for (const request of due) await deliverOne(world, request, date)
  // Requests are done with once delivered, declined, or their day has passed.
  world.requests = world.requests.filter(r => r.neededOn > date)
}

const TRANSIT_NOTES: Record<TransferVarianceReason, string> = {
  DAMAGED: 'A tray tipped over in the van',
  SPOILED: 'Arrived warm — the cooler box was not closed',
  MISSING: 'One bag not in the van when it arrived',
  OTHER:   'Counted short at the outlet',
}

async function deliverOne(world: World, request: OpenRequest, date: string) {
  const { cast, random } = world
  const kitchen = cast.kitchens.find(k => k.id === request.kitchenId)!
  const outlet  = cast.outlets.find(o => o.id === request.outletId)!
  const recordedAt   = at(date, '10:30', random.int(0, 40))
  const dispatchedAt = new Date(recordedAt.getTime() + random.int(20, 60) * 60_000)
  const receivedAt   = at(date, '13:00', random.int(0, 120))

  // What the kitchen actually has when the van leaves.
  const lines = request.lines
    .filter(line => line.planned > 0)
    .map(line => {
      const takes = planTakes(world, kitchen.id, line.good, line.planned, dispatchedAt)
      return { ...line, takes, sent: takes.reduce((sum, take) => sum + take.quantity, 0) }
    })
    .filter(line => line.sent > 0)
  if (lines.length === 0) return

  // Losses on the way: one lot of one good arrives short.
  const lossChance = kitchen.code === 'PSG' && outlet.code === 'MKT' ? 0.2 : 0.03
  let loss: { lotId: string; quantity: number; reason: TransferVarianceReason } | null = null
  if (random.chance(lossChance)) {
    const take = random.pick(lines.flatMap(line => line.takes))
    const quantity = Math.min(take.quantity, Math.ceil(random.between(0.5, 2) * 2) / 2)
    loss = { lotId: take.lot.id, quantity, reason: random.pick([TransferVarianceReason.DAMAGED, TransferVarianceReason.SPOILED, TransferVarianceReason.MISSING]) }
  }
  const arrivedOf = (lotId: string, sent: number) => (loss && loss.lotId === lotId ? Math.round((sent - loss.quantity) * 100) / 100 : sent)
  const varianceValue = loss
    ? decimal(loss.quantity).mul(world.lots.find(l => l.id === loss!.lotId)!.unitCost)
    : new Prisma.Decimal(0)

  await prisma.$transaction(async tx => {
    const transferNumber = await nextNumber(tx, 'trf_number_seq', 'TRF-')
    const transfer = await tx.stockTransfer.create({
      data: {
        transferNumber, kind: TransferKind.DELIVERY, status: TransferStatus.RECEIVED,
        fromBranchId: kitchen.id, toBranchId: outlet.id, submittedById: cast.staff.production,
        notes: `For ${request.number}`, stockRequestId: request.id,
        receivedById: outlet.managerId, receivedAt, varianceValue,
        varianceReason: loss?.reason ?? null, varianceNotes: loss ? TRANSIT_NOTES[loss.reason] : null,
        createdAt: recordedAt, updatedAt: receivedAt,
        items: { create: lines.map(line => ({ finishedGoodId: world.goods.get(line.good)!.id, quantity: decimal(line.sent) })) },
      },
      select: { id: true },
    })
    await tx.approval.create({
      data: { referenceType: 'StockTransfer', referenceId: transfer.id, approverId: cast.staff.accounting, decision: 'APPROVED', remarks: null, decidedAt: dispatchedAt },
    })
    for (const take of lines.flatMap(line => line.takes)) {
      await FinishedGoodStockRepository.takeFromLot(tx, {
        lotId: take.lot.id, branchId: kitchen.id, quantity: decimal(take.quantity), unitCost: take.lot.unitCost,
        type: MovementType.TRANSFER, referenceType: 'StockTransfer', referenceId: transfer.id, notes: transferNumber,
      })
      const arrived = arrivedOf(take.lot.id, take.quantity)
      if (arrived > 0) {
        await FinishedGoodStockRepository.transferIntoLot(tx, {
          lotId: take.lot.id, branchId: outlet.id, quantity: decimal(arrived), unitCost: take.lot.unitCost,
          referenceType: 'StockTransfer', referenceId: transfer.id, notes: transferNumber,
        })
      }
    }
    await tx.finishedGoodMovement.updateMany({ where: { referenceType: 'StockTransfer', referenceId: transfer.id, branchId: kitchen.id }, data: { createdAt: dispatchedAt } })
    await tx.finishedGoodMovement.updateMany({ where: { referenceType: 'StockTransfer', referenceId: transfer.id, branchId: outlet.id }, data: { createdAt: receivedAt } })

    // The receipt fulfils the request: everything asked arrived, or not (Week 9 Task 10, S-7).
    const full = request.lines.every(line => {
      const arrived = lines.filter(l => l.good === line.good).flatMap(l => l.takes).reduce((sum, take) => sum + arrivedOf(take.lot.id, take.quantity), 0)
      return arrived + 1e-9 >= line.asked
    })
    await tx.stockRequest.update({
      where: { id: request.id },
      data:  { status: full ? StockRequestStatus.FULFILLED : StockRequestStatus.PARTLY_FULFILLED, updatedAt: receivedAt },
    })
  })

  for (const take of lines.flatMap(line => line.takes)) {
    moveLot(take.lot, kitchen.id, -take.quantity)
    moveLot(take.lot, outlet.id, arrivedOf(take.lot.id, take.quantity))
  }
  count(world, 'deliveries')
  if (loss) count(world, 'deliveries with losses in transit')
}

