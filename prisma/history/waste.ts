import { ConversionStatus, MovementType, Prisma, TransferKind, TransferStatus, WriteOffReason, WriteOffStatus } from '@prisma/client'
import { addDays, isoDateAt } from '@/lib/dates'
import { prisma } from '@/lib/prisma'
import { FinishedGoodStockRepository } from '@/repositories/finished-good-stock.repository'
import { InventoryRepository } from '@/repositories/inventory.repository'
import { at, dateOnly } from './calendar'
import { expectedDemand, HOME_KITCHEN, type GoodCode } from './demand'
import { addStock, count, decimal, moveLot, nextNumber, planTakes, stockKey, type Lot, type World } from './world'

/**
 * Waste, the way the app records it (subtask 1.5):
 *   - closing: an outlet sends back Lechon that will not last another day
 *     (a RETURN, RTN-000001, no approval); the kitchen counts it in the next
 *     morning
 *   - morning: the kitchen converts the Lechon about to expire — returned or
 *     its own — into Lechon Paksiw (a conversion, approved by accounting)
 *   - morning: every lot that expired overnight, anywhere, is written off
 *     (EXPIRED); now and then a lot spoils early, a tray is dropped, or a
 *     batch fails the taste check
 *
 * Built-in patterns for the Waste Pattern Detector (Feature 3):
 *   - Alabang Outlet writes off Dinuguan week after week (it over-orders)
 *   - Las Piñas Commissary's Bopis fails the quality check now and then
 *   - Makati Outlet has more spoiled and damaged write-offs (warm display, busy counter)
 */

/** Lechon that expires before this many hours after closing goes back to the kitchen. */
const RETURN_WINDOW_HOURS = 24
/** Below this, Lechon is not worth a conversion: it expires and is written off. */
const MIN_CONVERSION_KG = 3
/** A kitchen converts only up to this many days of its outlets' Paksiw sales: more would expire. */
const PAKSIW_DAYS_OF_STOCK = 3
const SPOILED_CHANCE: Record<string, number> = { MKT: 0.05, default: 0.012 }
const DAMAGED_CHANCE: Record<string, number> = { MKT: 0.03, default: 0.006 }
const FAILED_QUALITY_CHANCE = 0.2

/** At closing, each outlet sends back the Lechon that will not sell before it expires. */
export async function sendReturns(world: World, date: string): Promise<void> {
  const { cast, random } = world
  const sentAt   = at(date, '21:30', random.int(0, 30))
  const cutoff   = new Date(sentAt.getTime() + RETURN_WINDOW_HOURS * 3_600_000)
  const lechon: GoodCode = world.conversion.source

  for (const outlet of cast.outlets) {
    const lots = world.lots.filter(lot => lot.good === lechon && (lot.at.get(outlet.id) ?? 0) > 0 && lot.expiresAt > sentAt && lot.expiresAt <= cutoff)
    if (lots.length === 0) continue
    const kitchen = cast.kitchens.find(k => k.code === HOME_KITCHEN[outlet.code])!
    const takes = lots.map(lot => ({ lot, quantity: lot.at.get(outlet.id)! }))
    const total = takes.reduce((sum, take) => sum + take.quantity, 0)
    // The last night's returns are still on the road: the kitchen counts them in (for whoever tests next).
    const inTransit  = date === world.lastDay
    const receivedAt = at(addDays(date, 1), '06:30', random.int(0, 30))

    await prisma.$transaction(async tx => {
      const transferNumber = await nextNumber(tx, 'rtn_number_seq', 'RTN-')
      const transfer = await tx.stockTransfer.create({
        data: {
          transferNumber, kind: TransferKind.RETURN, status: inTransit ? TransferStatus.APPROVED : TransferStatus.RECEIVED,
          fromBranchId: outlet.id, toBranchId: kitchen.id, submittedById: outlet.managerId, notes: 'Unsold — for Paksiw',
          ...(inTransit ? {} : { receivedById: cast.staff.production, receivedAt, varianceValue: new Prisma.Decimal(0) }),
          createdAt: sentAt, updatedAt: inTransit ? sentAt : receivedAt,
          items: { create: [{ finishedGoodId: world.goods.get(lechon)!.id, quantity: decimal(total) }] },
        },
        select: { id: true },
      })
      for (const take of takes) {
        await FinishedGoodStockRepository.takeFromLot(tx, {
          lotId: take.lot.id, branchId: outlet.id, quantity: decimal(take.quantity), unitCost: take.lot.unitCost,
          type: MovementType.TRANSFER, referenceType: 'StockTransfer', referenceId: transfer.id, notes: transferNumber,
        })
        if (inTransit) continue
        await FinishedGoodStockRepository.transferIntoLot(tx, {
          lotId: take.lot.id, branchId: kitchen.id, quantity: decimal(take.quantity), unitCost: take.lot.unitCost,
          referenceType: 'StockTransfer', referenceId: transfer.id, notes: transferNumber,
        })
      }
      await tx.finishedGoodMovement.updateMany({ where: { referenceType: 'StockTransfer', referenceId: transfer.id, branchId: outlet.id }, data: { createdAt: sentAt } })
      await tx.finishedGoodMovement.updateMany({ where: { referenceType: 'StockTransfer', referenceId: transfer.id, branchId: kitchen.id }, data: { createdAt: receivedAt } })
    })
    for (const take of takes) {
      moveLot(take.lot, outlet.id, -take.quantity)
      if (!inTransit) moveLot(take.lot, kitchen.id, take.quantity)
    }
    count(world, inTransit ? 'returns still on their way to the kitchen' : 'returns')
  }
}

/** In the morning, each kitchen converts the Lechon about to expire into Lechon Paksiw. */
export async function convert(world: World, date: string): Promise<void> {
  const { cast, random, prices, conversion } = world
  const output = world.goods.get(conversion.output)!
  for (const kitchen of cast.kitchens) {
    const recordedAt = at(date, '07:00', random.int(0, 20))
    const approvedAt = at(date, '07:45', random.int(0, 30))
    const soon = new Date(recordedAt.getTime() + RETURN_WINDOW_HOURS * 3_600_000)
    const candidates = world.lots.filter(lot => lot.good === conversion.source && lot.expiresAt > approvedAt && lot.expiresAt <= soon)
    const available = candidates.reduce((sum, lot) => sum + (lot.at.get(kitchen.id) ?? 0), 0)

    // No more Paksiw than the outlets this kitchen serves will sell in the next two days.
    let paksiwWanted = 0
    for (const [outlet, home] of Object.entries(HOME_KITCHEN)) {
      if (home !== kitchen.code) continue
      for (let day = 0; day < PAKSIW_DAYS_OF_STOCK; day++) paksiwWanted += expectedDemand(outlet, conversion.output, addDays(date, day))
    }
    const paksiwOnShelf = world.lots
      .filter(lot => lot.good === conversion.output && lot.expiresAt > approvedAt)
      .reduce((sum, lot) => sum + (lot.at.get(kitchen.id) ?? 0), 0)
    const outputPerSource = conversion.batchSize.div(conversion.sourceQuantity).toNumber()
    const room = Math.max(0, paksiwWanted - paksiwOnShelf) / outputPerSource

    // As much as there is room for and the added ingredients on hand allow.
    let sourceQty = Math.floor(Math.min(available, room) * 2) / 2
    for (const line of conversion.lines) {
      const perSource = line.quantity.div(conversion.sourceQuantity).toNumber()
      const have = world.onHand.get(stockKey(kitchen.id, line.materialId)) ?? 0
      sourceQty = Math.min(sourceQty, Math.floor((have / perSource) * 2) / 2)
    }
    if (sourceQty < MIN_CONVERSION_KG) continue

    const takes = planTakes(world, kitchen.id, conversion.source, sourceQty, approvedAt)
    const source = decimal(sourceQty)
    const conversionDate = isoDateAt(recordedAt)
    const ingredients = conversion.lines.map(line => {
      const unitCost = prices.asOf(line.materialId, conversionDate)
      if (!unitCost) throw new Error(`No reference price for ${world.materialById.get(line.materialId)?.code} on ${conversionDate}`)
      return { materialId: line.materialId, quantity: line.quantity.mul(source).div(conversion.sourceQuantity), unitCost }
    })
    const outputQty      = decimal(source.div(conversion.sourceQuantity).mul(conversion.batchSize).toNumber() * random.between(0.95, 1.0))
    const sourceCost     = takes.reduce((sum, take) => sum.add(decimal(take.quantity).mul(take.lot.unitCost)), new Prisma.Decimal(0))
    const conversionCost = ingredients.reduce((sum, line) => sum.add(line.quantity.mul(line.unitCost)), new Prisma.Decimal(0))
    const costPerUnit    = sourceCost.add(conversionCost).div(outputQty)
    const expiresAt      = new Date(recordedAt.getTime() + output.shelfLifeHours * 3_600_000)

    const created = await prisma.$transaction(async tx => {
      const orderNumber = await nextNumber(tx, 'cnv_number_seq', 'CNV-')
      const order = await tx.conversionOrder.create({
        data: {
          orderNumber, bomId: conversion.bomId, finishedGoodId: output.id, sourceFinishedGoodId: world.goods.get(conversion.source)!.id,
          branchId: kitchen.id, submittedById: cast.staff.production, status: ConversionStatus.APPROVED,
          sourceQty: source, outputQty, sourceCost, conversionCost, costPerUnit,
          notes: 'Lechon about to expire', createdAt: recordedAt, updatedAt: approvedAt,
        },
        select: { id: true },
      })
      await tx.approval.create({
        data: { referenceType: 'ConversionOrder', referenceId: order.id, approverId: cast.staff.accounting, decision: 'APPROVED', remarks: null, decidedAt: approvedAt },
      })
      const reference = { referenceType: 'ConversionOrder', referenceId: order.id, notes: orderNumber }
      for (const take of takes) {
        await FinishedGoodStockRepository.takeFromLot(tx, { lotId: take.lot.id, branchId: kitchen.id, quantity: decimal(take.quantity), unitCost: take.lot.unitCost, ...reference })
      }
      for (const line of [...ingredients].sort((a, b) => (a.materialId < b.materialId ? -1 : 1))) {
        if (!line.quantity.greaterThan(0)) continue
        await InventoryRepository.stockOut(tx, { materialId: line.materialId, branchId: kitchen.id, quantity: line.quantity, unitCost: line.unitCost, ...reference })
      }
      const { lotId } = await FinishedGoodStockRepository.receiveLot(tx, {
        lotNumber: orderNumber, finishedGoodId: output.id, conversionOrderId: order.id, producedOn: dateOnly(conversionDate), expiresAt,
        branchId: kitchen.id, quantity: outputQty, unitCost: costPerUnit, ...reference,
      })
      await tx.stockMovement.updateMany({ where: { referenceType: 'ConversionOrder', referenceId: order.id }, data: { createdAt: approvedAt } })
      await tx.finishedGoodMovement.updateMany({ where: { referenceType: 'ConversionOrder', referenceId: order.id }, data: { createdAt: approvedAt } })
      await tx.finishedGoodLot.update({ where: { id: lotId }, data: { createdAt: approvedAt } })
      return { lotId, orderNumber }
    })

    for (const take of takes) moveLot(take.lot, kitchen.id, -take.quantity)
    for (const line of ingredients) addStock(world, kitchen.id, line.materialId, -line.quantity.toNumber())
    world.lots.push({
      id: created.lotId, number: created.orderNumber, good: conversion.output, expiresAt, unitCost: costPerUnit,
      at: new Map([[kitchen.id, outputQty.toNumber()]]),
    })
    count(world, 'conversions')
  }
}

async function writeOff(world: World, lot: Lot, branchId: string, quantity: number, reason: WriteOffReason, recordedAt: Date, approvedAt: Date) {
  const { cast } = world
  const qty = decimal(quantity)
  await prisma.$transaction(async tx => {
    const writeOffNumber = await nextNumber(tx, 'wo_number_seq', 'WO-')
    const row = await tx.writeOff.create({
      data: {
        writeOffNumber, lotId: lot.id, branchId, submittedById: cast.staff.production, status: WriteOffStatus.APPROVED,
        quantity: qty, reason, notes: null, unitCost: lot.unitCost, totalCost: qty.mul(lot.unitCost),
        createdAt: recordedAt, updatedAt: approvedAt,
      },
      select: { id: true },
    })
    await tx.approval.create({
      data: { referenceType: 'WriteOff', referenceId: row.id, approverId: cast.staff.accounting, decision: 'APPROVED', remarks: null, decidedAt: approvedAt },
    })
    await FinishedGoodStockRepository.takeFromLot(tx, {
      lotId: lot.id, branchId, quantity: qty, unitCost: lot.unitCost,
      type: MovementType.WASTE, referenceType: 'WriteOff', referenceId: row.id, notes: writeOffNumber,
    })
    await tx.finishedGoodMovement.updateMany({ where: { referenceType: 'WriteOff', referenceId: row.id }, data: { createdAt: approvedAt } })
  })
  moveLot(lot, branchId, -quantity)
  count(world, `write-offs (${reason.toLowerCase().replace('_', ' ')})`)
}

/** In the morning: everything that expired overnight is written off, and the odd lot that spoiled or was dropped. */
export async function writeOffs(world: World, date: string): Promise<void> {
  const { random, cast } = world
  const recordedAt = () => at(date, '07:30', random.int(0, 40))
  const approvedAt = () => at(date, '09:00', random.int(0, 90))
  const morning = at(date, '07:30')
  const branches = [...cast.kitchens.map(k => ({ id: k.id, code: k.code })), ...cast.outlets.map(o => ({ id: o.id, code: o.code }))]

  for (const branch of branches) {
    for (const lot of world.lots) {
      const quantity = lot.at.get(branch.id) ?? 0
      if (quantity > 0 && lot.expiresAt <= morning) await writeOff(world, lot, branch.id, quantity, WriteOffReason.EXPIRED, recordedAt(), approvedAt())
    }
  }

  // Before their expiry: spoiled on display, or dropped — more often at Makati Outlet.
  for (const outlet of cast.outlets) {
    for (const [reason, chances] of [[WriteOffReason.SPOILED, SPOILED_CHANCE], [WriteOffReason.DAMAGED, DAMAGED_CHANCE]] as const) {
      if (!random.chance(chances[outlet.code] ?? chances.default)) continue
      const lots = world.lots.filter(lot => (lot.at.get(outlet.id) ?? 0) >= 1 && lot.expiresAt > morning)
      if (lots.length === 0) continue
      const lot = random.pick(lots)
      const quantity = Math.min(lot.at.get(outlet.id)!, Math.ceil(random.between(1, 3) * 2) / 2)
      await writeOff(world, lot, outlet.id, quantity, reason, at(date, '12:00', random.int(0, 360)), at(date, '18:00', random.int(0, 60)))
    }
  }
}

/** After a run is signed off: a Las Piñas Bopis batch sometimes fails the taste check, and part of it is written off. */
export async function qualityCheck(world: World, date: string, lotsMadeToday: Lot[]): Promise<void> {
  const { random, cast } = world
  const lps = cast.kitchens.find(k => k.code === 'LPS')
  if (!lps) return
  for (const lot of lotsMadeToday) {
    if (lot.good !== 'FG-BOPIS' || !(lot.at.get(lps.id)) || !random.chance(FAILED_QUALITY_CHANCE)) continue
    const quantity = Math.min(lot.at.get(lps.id)!, Math.ceil(random.between(1, 2.5) * 2) / 2)
    await writeOff(world, lot, lps.id, quantity, WriteOffReason.FAILED_QUALITY, at(date, '11:30', random.int(0, 30)), at(date, '13:00', random.int(0, 60)))
  }
}
