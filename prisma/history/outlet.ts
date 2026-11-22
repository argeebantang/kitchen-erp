import { Prisma, StockRequestStatus, MovementType } from '@prisma/client'
import { addDays } from '@/lib/dates'
import { prisma } from '@/lib/prisma'
import { FinishedGoodStockRepository } from '@/repositories/finished-good-stock.repository'
import { at, dateOnly, isHoliday, PH_HOLIDAYS_2026 } from './calendar'
import { expectedDemand, GOOD_CODES, HOME_KITCHEN, type GoodCode } from './demand'
import { count, decimal, halfKilos, moveLot, nextNumber, planTakes, sellable, type World } from './world'

/**
 * The outlets' side of the history (subtask 1.4):
 *   - afternoon: each outlet asks a kitchen for tomorrow's goods (a stock
 *     request), usually its home kitchen, sometimes another
 *   - closing: it records what it sold (Daily Sales) — what customers wanted,
 *     as far as the unexpired stock went
 *
 * Built-in patterns:
 *   - Alabang Outlet over-orders Dinuguan by half again (it then expires or goes back)
 *   - Makati Outlet often asks after the 15:00 cut-off (late)
 */

/** How much more than expected sales an outlet asks for. */
const ORDER_BUFFER = 1.05
const OVER_ORDER: Record<string, Partial<Record<GoodCode, number>>> = { ALB: { 'FG-DINUGUAN': 1.5 } }
const LATE_CHANCE: Record<string, number> = { CUB: 0.05, MKT: 0.25, ALB: 0.08 }
/** Asks a kitchen other than its home one this often. */
const OTHER_KITCHEN_CHANCE = 0.1
/** What customers want varies this much around the expected figure. */
const DEMAND_NOISE = 0.2

/** In the afternoon of `date`, every outlet asks for `date` + 1. */
export async function submitRequests(world: World, date: string): Promise<void> {
  const { random, cast } = world
  const neededOn = addDays(date, 1)
  const holiday  = PH_HOLIDAYS_2026.find(h => h.date === neededOn)

  for (const outlet of cast.outlets) {
    const late = random.chance(LATE_CHANCE[outlet.code] ?? 0.05)
    const submittedAt = late ? at(date, '15:05', random.int(0, 180)) : at(date, '10:00', random.int(0, 290))
    const homeCode = HOME_KITCHEN[outlet.code]
    const others   = cast.kitchens.filter(k => k.code !== homeCode)
    const kitchen  = random.chance(OTHER_KITCHEN_CHANCE) ? random.pick(others) : cast.kitchens.find(k => k.code === homeCode)!

    // What will still be good tomorrow evening, after today's expected sales.
    const lines: { good: GoodCode; asked: number }[] = []
    for (const good of GOOD_CODES) {
      const carry  = Math.max(0, sellable(world, outlet.id, good, at(neededOn, '20:00')) - expectedDemand(outlet.code, good, date))
      const wanted = expectedDemand(outlet.code, good, neededOn) * ORDER_BUFFER * (OVER_ORDER[outlet.code]?.[good] ?? 1)
      const asked  = halfKilos(Math.max(0, wanted - carry))
      if (asked >= 0.5) lines.push({ good, asked })
    }
    if (lines.length === 0) continue

    const request = await prisma.$transaction(async tx => {
      const requestNumber = await nextNumber(tx, 'str_number_seq', 'STR-')
      return tx.stockRequest.create({
        data: {
          requestNumber,
          branchId:      outlet.id,
          kitchenId:     kitchen.id,
          neededOn:      dateOnly(neededOn),
          status:        StockRequestStatus.SUBMITTED,
          late,
          submittedById: outlet.managerId,
          notes:         holiday && isHoliday(neededOn) ? `${holiday.name} — expect a busy day` : null,
          createdAt:     submittedAt,
          updatedAt:     submittedAt,
          items: {
            create: lines.map(line => ({ finishedGoodId: world.goods.get(line.good)!.id, quantity: decimal(line.asked) })),
          },
        },
        select: { id: true, requestNumber: true },
      })
    })
    world.requests.push({
      id: request.id, number: request.requestNumber, outletId: outlet.id, kitchenId: kitchen.id, neededOn,
      status: 'SUBMITTED', lines: lines.map(line => ({ ...line, planned: 0 })),
    })
    count(world, 'stock requests')
  }
}

/** At closing, each outlet records what it sold. */
export async function recordSales(world: World, date: string): Promise<void> {
  const { random, cast } = world
  for (const outlet of cast.outlets) {
    const recordedAt = at(date, '20:30', random.int(0, 75))
    const sold: { good: GoodCode; quantity: number; takes: ReturnType<typeof planTakes> }[] = []
    for (const good of GOOD_CODES) {
      const wanted    = expectedDemand(outlet.code, good, date) * random.between(1 - DEMAND_NOISE, 1 + DEMAND_NOISE)
      const available = sellable(world, outlet.id, good, recordedAt)
      const quantity  = Math.floor(Math.min(wanted, available) * 2) / 2
      if (quantity <= 0) continue
      sold.push({ good, quantity, takes: planTakes(world, outlet.id, good, quantity, recordedAt) })
    }
    if (sold.length === 0) continue

    const zero  = new Prisma.Decimal(0)
    const items = sold.map(line => {
      const good = world.goods.get(line.good)!
      const quantity = decimal(line.quantity)
      return { finishedGoodId: good.id, quantity, unitPrice: good.sellingPrice, amount: quantity.mul(good.sellingPrice) }
    })
    const totalCost = sold.flatMap(line => line.takes).reduce((sum, take) => sum.add(decimal(take.quantity).mul(take.lot.unitCost)), zero)

    await prisma.$transaction(async tx => {
      const saleNumber = await nextNumber(tx, 'sls_number_seq', 'SLS-')
      const sale = await tx.outletSale.create({
        data: {
          saleNumber, branchId: outlet.id, soldOn: dateOnly(date), submittedById: outlet.managerId,
          totalAmount: items.reduce((sum, item) => sum.add(item.amount), zero), totalCost,
          createdAt: recordedAt, items: { create: items },
        },
        select: { id: true },
      })
      for (const take of sold.flatMap(line => line.takes)) {
        await FinishedGoodStockRepository.takeFromLot(tx, {
          lotId: take.lot.id, branchId: outlet.id, quantity: decimal(take.quantity), unitCost: take.lot.unitCost,
          type: MovementType.OUT, referenceType: 'OutletSale', referenceId: sale.id, notes: saleNumber,
        })
      }
      await tx.finishedGoodMovement.updateMany({ where: { referenceType: 'OutletSale', referenceId: sale.id }, data: { createdAt: recordedAt } })
    })
    for (const take of sold.flatMap(line => line.takes)) moveLot(take.lot, outlet.id, -take.quantity)
    count(world, 'daily sales')
  }
}
