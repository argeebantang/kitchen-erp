import { POStatus, PRStatus, Prisma, RRStatus } from '@prisma/client'
import { addDays } from '@/lib/dates'
import { prisma } from '@/lib/prisma'
import { InventoryRepository } from '@/repositories/inventory.repository'
import { at, dateOnly, weekday, WEEKDAY_NAMES } from './calendar'
import { expectedDemand, GOOD_CODES, HOME_KITCHEN } from './demand'
import { addStock, count, decimal, nextNumber, stockKey, type Incoming, type World } from './world'

/**
 * Purchasing history (subtask 1.2): each kitchen orders twice a week from each
 * supplier, through the app's full flow —
 *
 *   PR (production) → approved (accounting) → PO drafted → sourced and
 *   submitted (procurement) → approved (accounting) → sent (procurement) →
 *   delivered after the supplier's lead time → receiving report (procurement)
 *   → approved (accounting), stock in.
 *
 * Built-in patterns for the Supplier Performance Analyzer (Feature 6):
 *   - Nueva Ecija Fresh Produce short-delivers Red Onion on ~40 % of deliveries
 *   - Divisoria Dry Goods Trading delivers 1–3 days late on ~45 % of orders
 *   - Bantang Meat Supply is reliable
 * Produce lines are sometimes partly rejected (bruised), meat rarely.
 */

/** Monday and Thursday. */
const ORDER_DAYS = new Set([1, 4])
/** Extra days of stock above lead time and the gap to the next order; more from a supplier that is often late. */
const SAFETY_DAYS = 2
const LATE_SUPPLIER_SAFETY_DAYS = 3
/**
 * Whole batches use more than the average demand (a 6 kg order is cooked as
 * a 10 kg batch), so purchasing plans on this much above expected sales.
 */
const PURCHASE_MARGIN = 1.4
/** A short delivery's remainder arrives two days later this often; otherwise it never comes. */
const FOLLOW_UP_CHANCE = 0.5
/** How many of the history's last order days Las Piñas misses its produce order on. */
const MISSED_PRODUCE_ORDERS = 3

/** Expected kg of a material a kitchen uses on a date: what its outlets sell, cooked with a margin. */
function expectedUsage(world: World, kitchenCode: string, materialId: string, date: string): number {
  let usage = 0
  for (const [outlet, home] of Object.entries(HOME_KITCHEN)) {
    if (home !== kitchenCode) continue
    for (const good of GOOD_CODES) {
      const perKg = world.perKg.get(good)?.get(materialId)
      if (perKg) usage += expectedDemand(outlet, good, date) * PURCHASE_MARGIN * perKg
    }
  }
  return usage
}

/** Days from an order day to the next one (Mon → Thu 3, Thu → Mon 4). */
function daysToNextOrder(date: string): number {
  for (let days = 1; days <= 7; days++) if (ORDER_DAYS.has(weekday(addDays(date, days)))) return days
  return 7
}

/** Order sizes people actually use: at least a kilo, whole kilos, then fives. */
function roundOrder(quantity: number): number {
  if (quantity <= 1) return 1
  if (quantity <= 50) return Math.ceil(quantity)
  return Math.ceil(quantity / 5) * 5
}

function onOrder(world: World, kitchenId: string, materialId: string): number {
  return world.incoming
    .filter(delivery => delivery.kitchenId === kitchenId)
    .flatMap(delivery => delivery.lines)
    .filter(line => line.materialId === materialId)
    .reduce((sum, line) => sum + line.quantity, 0)
}

/** Days late for this order, by the supplier's pattern. */
function delayDays(world: World, pattern: string): number {
  const { random } = world
  if (pattern === 'often-late') return random.chance(0.45) ? random.int(1, 3) : 0
  if (pattern === 'short-onions') return random.chance(0.1) ? 1 : 0
  return random.chance(0.05) ? 1 : 0
}

/** On an order day, every kitchen orders what it will need from each supplier. */
export async function placeOrders(world: World, date: string): Promise<void> {
  if (!ORDER_DAYS.has(weekday(date))) return
  const coverBase = daysToNextOrder(date) + SAFETY_DAYS

  // The history's last three order days (a week and a half): Las Piñas misses
  // its produce orders, so it ends with its vegetables below their reorder
  // points — real 🟡 / 🔴 tiles on the stock map for the Reorder Recommender (Feature 4).
  let orderDaysLeft = 0
  for (let day = date; day <= world.lastDay; day = addDays(day, 1)) if (ORDER_DAYS.has(weekday(day))) orderDaysLeft++
  const missedProduce = orderDaysLeft > 0 && orderDaysLeft <= MISSED_PRODUCE_ORDERS

  for (const kitchen of world.cast.kitchens) {
    for (const supplier of world.cast.suppliers) {
      if (missedProduce && kitchen.code === 'LPS' && supplier.pattern === 'short-onions') continue
      const cover = coverBase + supplier.leadTimeDays + (supplier.pattern === 'often-late' ? LATE_SUPPLIER_SAFETY_DAYS : 0)
      const lines: { materialId: string; quantity: number }[] = []
      for (const code of supplier.materialCodes) {
        const material = world.materials.get(code)
        if (!material) continue
        let usage = 0
        for (let day = 0; day < cover; day++) usage += expectedUsage(world, kitchen.code, material.id, addDays(date, day))
        if (usage === 0) continue
        // The reorder point is the safety stock the kitchen keeps on top (Master Data).
        const need = usage + material.reorderPoint
        const position = (world.onHand.get(stockKey(kitchen.id, material.id)) ?? 0) + onOrder(world, kitchen.id, material.id)
        if (position >= need) continue
        lines.push({ materialId: material.id, quantity: roundOrder(need - position) })
      }
      if (lines.length > 0) await purchase(world, date, kitchen, supplier, lines)
    }
  }
}

async function purchase(
  world: World,
  date: string,
  kitchen: World['cast']['kitchens'][number],
  supplier: World['cast']['suppliers'][number],
  lines: { materialId: string; quantity: number }[],
): Promise<void> {
  const { random, cast, prices } = world
  const raisedAt     = at(date, '08:00', random.int(0, 60))
  const prApprovedAt = at(date, '09:30', random.int(0, 45))
  const poApprovedAt = at(date, '13:00', random.int(0, 45))
  const sentAt       = at(date, '14:00', random.int(0, 30))
  const promised     = addDays(date, supplier.leadTimeDays)
  const due          = addDays(promised, delayDays(world, supplier.pattern))

  const priced = lines.map(line => {
    const unitCost  = prices.asOf(line.materialId, date, supplier.id)
    const reference = prices.asOf(line.materialId, date)
    if (!unitCost) throw new Error(`No price for ${world.materialById.get(line.materialId)?.code} on ${date}`)
    return { ...line, quantityDecimal: decimal(line.quantity), unitCost, reference }
  })
  const totalAmount = priced.reduce((sum, line) => sum.add(line.unitCost.mul(line.quantityDecimal)), new Prisma.Decimal(0))

  const order = await prisma.$transaction(async tx => {
    const prNumber = await nextNumber(tx, 'pr_number_seq', 'PR-')
    const request = await tx.purchaseRequest.create({
      data: {
        prNumber,
        requestedById: cast.staff.production,
        status:        PRStatus.CONVERTED_TO_PO,
        notes:         `For ${kitchen.name} — ${WEEKDAY_NAMES[weekday(date)]} order, ${supplier.name}`,
        neededBy:      dateOnly(promised),
        createdAt:     raisedAt,
        updatedAt:     prApprovedAt,
        items: {
          create: priced.map(line => ({
            materialId: line.materialId, quantity: line.quantityDecimal, estimatedUnitCost: line.reference,
          })),
        },
      },
    })
    await tx.approval.create({
      data: {
        referenceType: 'PurchaseRequest', referenceId: request.id, approverId: cast.staff.accounting,
        decision: 'APPROVED', remarks: null, decidedAt: prApprovedAt,
      },
    })

    const poNumber = await nextNumber(tx, 'po_number_seq', 'PO-')
    const po = await tx.purchaseOrder.create({
      data: {
        poNumber,
        purchaseRequestId: request.id,
        supplierId:        supplier.id,
        submittedById:     cast.staff.procurement,
        status:            POStatus.SENT,
        totalAmount,
        expectedDelivery:  dateOnly(promised),
        createdAt:         prApprovedAt,
        updatedAt:         sentAt,
        items: {
          create: priced.map(line => ({
            materialId: line.materialId, quantity: line.quantityDecimal,
            unitCost: line.unitCost, totalCost: line.unitCost.mul(line.quantityDecimal),
          })),
        },
      },
      select: { id: true, items: { select: { id: true, materialId: true, quantity: true, unitCost: true } } },
    })
    await tx.approval.create({
      data: {
        referenceType: 'PurchaseOrder', referenceId: po.id, approverId: cast.staff.accounting,
        decision: 'APPROVED', remarks: null, decidedAt: poApprovedAt,
      },
    })
    return po
  })

  world.incoming.push({
    purchaseOrderId: order.id,
    kitchenId:       kitchen.id,
    supplierId:      supplier.id,
    due,
    followUp:        false,
    lines: order.items.map(item => ({
      purchaseOrderItemId: item.id, materialId: item.materialId,
      quantity: item.quantity.toNumber(), ordered: item.quantity.toNumber(), unitCost: item.unitCost,
    })),
  })
  count(world, 'purchase requests and orders')
}

/** Deliveries due today arrive in the morning and are counted. */
export async function receiveDeliveries(world: World, date: string): Promise<void> {
  const due = world.incoming.filter(delivery => delivery.due === date)
  world.incoming = world.incoming.filter(delivery => delivery.due !== date)
  for (const delivery of due) await receive(world, date, delivery)
}

async function receive(world: World, date: string, delivery: Incoming): Promise<void> {
  const { random, cast } = world
  const supplier   = cast.suppliers.find(s => s.id === delivery.supplierId)!
  const receivedAt = at(date, '07:00', random.int(0, 150))
  const approvedAt = new Date(receivedAt.getTime() + random.int(60, 180) * 60_000)
  const produce    = supplier.pattern === 'short-onions'

  const counted = delivery.lines.map(line => {
    const code = world.materialById.get(line.materialId)?.code
    let received = line.quantity
    let note: string | null = null
    if (!delivery.followUp) {
      const shortChance = supplier.pattern === 'short-onions' && code === 'RM-ONION-RED' ? 0.4 : supplier.pattern === 'reliable' ? 0.03 : 0.05
      if (random.chance(shortChance)) {
        const fraction = code === 'RM-ONION-RED' ? random.between(0.15, 0.35) : random.between(0.05, 0.12)
        received = Math.max(0, Math.floor(line.quantity * (1 - fraction) * 2) / 2)
        if (received < line.quantity) note = 'short'
      }
    }
    let rejected = 0
    if (random.chance(produce ? 0.08 : 0.03)) {
      rejected = Math.min(received, Math.ceil(received * random.between(0.03, 0.1) * 2) / 2)
      if (rejected > 0) note = note ? `${note}, part rejected` : 'part rejected'
    }
    return { ...line, received, rejected, note }
  })

  const shortNames = counted.filter(line => line.note?.includes('short')).map(line => world.materialById.get(line.materialId)?.name)
  const rejectedNames = counted.filter(line => line.note?.includes('rejected')).map(line => world.materialById.get(line.materialId)?.name)
  const notes = [
    shortNames.length > 0 ? `Supplier short on ${shortNames.join(', ')}` : null,
    rejectedNames.length > 0 ? `${rejectedNames.join(', ')} partly rejected — ${produce ? 'bruised' : 'not fresh'}` : null,
    delivery.followUp ? 'Balance of the earlier short delivery' : null,
  ].filter(Boolean).join('. ') || null

  await prisma.$transaction(async tx => {
    const rrNumber = await nextNumber(tx, 'rr_number_seq', 'RR-')
    const report = await tx.receivingReport.create({
      data: {
        rrNumber,
        purchaseOrderId: delivery.purchaseOrderId,
        branchId:        delivery.kitchenId,
        receivedById:    cast.staff.procurement,
        status:          RRStatus.APPROVED,
        receivedAt,
        notes,
        createdAt:       receivedAt,
        items: {
          create: counted.map(line => ({
            purchaseOrderItemId: line.purchaseOrderItemId,
            materialId:          line.materialId,
            orderedQuantity:     decimal(line.ordered),
            expectedQuantity:    decimal(line.quantity),
            receivedQuantity:    decimal(line.received),
            rejectedQuantity:    decimal(line.rejected),
            unitCost:            line.unitCost,
          })),
        },
      },
    })
    await tx.approval.create({
      data: {
        referenceType: 'ReceivingReport', referenceId: report.id, approverId: cast.staff.accounting,
        decision: 'APPROVED', remarks: null, decidedAt: approvedAt,
      },
    })
    for (const line of counted) {
      const accepted = line.received - line.rejected
      if (accepted <= 0) continue
      await InventoryRepository.stockIn(tx, {
        materialId: line.materialId, branchId: delivery.kitchenId, quantity: decimal(accepted), unitCost: line.unitCost,
        referenceType: 'ReceivingReport', referenceId: report.id, notes: rrNumber,
      })
    }
    // Stock moves when accounting approves (Week 4): the ledger rows carry that moment.
    await tx.stockMovement.updateMany({
      where: { referenceType: 'ReceivingReport', referenceId: report.id },
      data:  { createdAt: approvedAt },
    })

    // The order's status from everything accepted against it so far, as the app does.
    const accepted = await tx.receivingReportItem.groupBy({
      by:    ['purchaseOrderItemId'],
      where: { receivingReport: { purchaseOrderId: delivery.purchaseOrderId, status: RRStatus.APPROVED } },
      _sum:  { receivedQuantity: true, rejectedQuantity: true },
    })
    const items = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: delivery.purchaseOrderId }, select: { id: true, quantity: true } })
    const acceptedBy = new Map(accepted.map(a => [a.purchaseOrderItemId, (a._sum.receivedQuantity ?? new Prisma.Decimal(0)).sub(a._sum.rejectedQuantity ?? 0)]))
    const full = items.every(item => !(acceptedBy.get(item.id) ?? new Prisma.Decimal(0)).lessThan(item.quantity))
    const any  = items.some(item => (acceptedBy.get(item.id) ?? new Prisma.Decimal(0)).greaterThan(0))
    await tx.purchaseOrder.update({
      where: { id: delivery.purchaseOrderId },
      data:  { status: full ? POStatus.FULLY_RECEIVED : any ? POStatus.PARTIALLY_RECEIVED : POStatus.SENT, updatedAt: approvedAt },
    })
  })

  for (const line of counted) addStock(world, delivery.kitchenId, line.materialId, line.received - line.rejected)
  count(world, 'receiving reports')

  // What did not come (short, not rejected — a rejected part is not re-sent) may follow two days later.
  const remainder = counted.filter(line => line.received < line.quantity)
  if (remainder.length > 0 && !delivery.followUp && random.chance(FOLLOW_UP_CHANCE)) {
    world.incoming.push({
      ...delivery,
      due:      addDays(date, 2),
      followUp: true,
      lines:    remainder.map(line => ({
        purchaseOrderItemId: line.purchaseOrderItemId, materialId: line.materialId, unitCost: line.unitCost,
        ordered: line.ordered, quantity: line.quantity - line.received,
      })),
    })
  }
}
