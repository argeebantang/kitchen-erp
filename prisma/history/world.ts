import { BomKind, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { Cast } from './master'
import type { Random } from './random'
import { loadPrices, type Prices } from './prices'
import { GOOD_CODES, type GoodCode } from './demand'

/**
 * Everything the simulation reads and remembers while it runs. Stock is
 * mirrored in memory (`onHand`) so a decision never needs a query; the
 * database is written through the repositories as the day happens, and the
 * two agree because every change goes through `addStock`.
 */
export type World = {
  cast: Cast
  random: Random
  prices: Prices
  materials: Map<string, Material>
  materialById: Map<string, Material>
  /** Material per kg of output, per finished good's active PRODUCTION recipe. */
  perKg: Map<GoodCode, Map<string, number>>
  onHand: Map<string, number>
  /** Deliveries on their way, for purchasing's "already ordered". */
  incoming: Incoming[]
  counts: Map<string, number>
  goods: Map<GoodCode, Good>
  /** Every history lot, with how much of it is at each branch. */
  lots: Lot[]
  /** Outlet requests waiting to be planned, delivered or closed. */
  requests: OpenRequest[]
  /** Production orders approved for a day, waiting to run. */
  scheduled: ScheduledRun[]
  /** The history's last day. */
  lastDay: string
  /** Unsold Lechon into Lechon Paksiw: the active CONVERSION recipe. */
  conversion: Conversion
}

export type Conversion = {
  bomId: string
  output: GoodCode
  source: GoodCode
  /** Output per batch, and the source one batch uses. */
  batchSize: Prisma.Decimal
  sourceQuantity: Prisma.Decimal
  lines: { materialId: string; quantity: Prisma.Decimal }[]
}

export type Material = { id: string; code: string; name: string; reorderPoint: number }

export type Good = {
  id: string
  code: GoodCode
  name: string
  shelfLifeHours: number
  sellingPrice: Prisma.Decimal
  bomId: string
  batchSize: Prisma.Decimal
  /** The active PRODUCTION recipe's lines, merged per material, per batch of batchSize. */
  bomLines: { materialId: string; quantity: Prisma.Decimal }[]
}

export type Lot = {
  id: string
  number: string
  good: GoodCode
  expiresAt: Date
  unitCost: Prisma.Decimal
  at: Map<string, number>
}

export type OpenRequest = {
  id: string
  number: string
  outletId: string
  kitchenId: string
  neededOn: string
  status: 'SUBMITTED' | 'PLANNED' | 'DECLINED'
  lines: { good: GoodCode; asked: number; planned: number }[]
}

export type ScheduledRun = {
  id: string
  number: string
  kitchenId: string
  good: GoodCode
  date: string
  plannedQty: Prisma.Decimal
  batchCount: number
  batchWeight: Prisma.Decimal
}

export type Incoming = {
  purchaseOrderId: string
  kitchenId: string
  supplierId: string
  due: string
  /** Order line id → quantity still to come with this delivery. */
  lines: { purchaseOrderItemId: string; materialId: string; quantity: number; unitCost: Prisma.Decimal; ordered: number }[]
  /** A follow-up for what a short delivery left out. */
  followUp: boolean
}

export const stockKey = (branchId: string, materialId: string) => `${branchId}:${materialId}`

export function addStock(world: World, branchId: string, materialId: string, quantity: number) {
  const key = stockKey(branchId, materialId)
  world.onHand.set(key, (world.onHand.get(key) ?? 0) + quantity)
}

export function count(world: World, label: string, by = 1) {
  world.counts.set(label, (world.counts.get(label) ?? 0) + by)
}

/** A quantity for the database: 2 decimals, never a binary float. */
export function decimal(value: number, places = 2): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(places))
}

/** Next document number from the app's own sequence, e.g. PO-000012. */
export async function nextNumber(tx: Prisma.TransactionClient, sequence: string, prefix: string): Promise<string> {
  const [row] = await tx.$queryRawUnsafe<{ nextval: bigint }[]>(`SELECT nextval('${sequence}')`)
  return `${prefix}${row.nextval.toString().padStart(6, '0')}`
}

export async function loadWorld(cast: Cast, random: Random, lastDay: string): Promise<World> {
  const [materialRows, boms, levels, prices, goodRows, conversionBom] = await Promise.all([
    prisma.material.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, reorderPoint: true } }),
    prisma.bOM.findMany({
      where:  { isActive: true, kind: BomKind.PRODUCTION, finishedGood: { code: { in: [...GOOD_CODES] } } },
      select: { id: true, batchSize: true, finishedGood: { select: { code: true } }, items: { select: { materialId: true, quantity: true } } },
    }),
    prisma.inventoryLevel.findMany({ select: { branchId: true, materialId: true, quantity: true } }),
    loadPrices(),
    prisma.finishedGood.findMany({
      where:  { code: { in: [...GOOD_CODES] } },
      select: { id: true, code: true, name: true, shelfLifeHours: true, sellingPrice: true },
    }),
    prisma.bOM.findFirst({
      where:  { isActive: true, kind: BomKind.CONVERSION, finishedGood: { code: 'FG-LECHON-PAKSIW' }, sourceFinishedGood: { code: 'FG-LECHON' } },
      select: { id: true, batchSize: true, sourceQuantity: true, items: { select: { materialId: true, quantity: true } } },
    }),
  ])
  if (!conversionBom || conversionBom.sourceQuantity === null) throw new Error('Lechon Paksiw has no active conversion recipe from Lechon')
  const conversionLines = new Map<string, Prisma.Decimal>()
  for (const item of conversionBom.items) conversionLines.set(item.materialId, (conversionLines.get(item.materialId) ?? new Prisma.Decimal(0)).add(item.quantity))

  const goods = new Map<GoodCode, Good>()
  for (const row of goodRows) {
    const bom = boms.find(b => b.finishedGood.code === row.code)
    if (!bom) throw new Error(`${row.name} has no active production recipe`)
    if (row.shelfLifeHours === null) throw new Error(`${row.name} has no shelf life — set it in Master Data first`)
    const merged = new Map<string, Prisma.Decimal>()
    for (const item of bom.items) merged.set(item.materialId, (merged.get(item.materialId) ?? new Prisma.Decimal(0)).add(item.quantity))
    goods.set(row.code as GoodCode, {
      id: row.id, code: row.code as GoodCode, name: row.name, shelfLifeHours: row.shelfLifeHours, sellingPrice: row.sellingPrice,
      bomId: bom.id, batchSize: bom.batchSize,
      bomLines: [...merged].map(([materialId, quantity]) => ({ materialId, quantity })),
    })
  }

  const perKg = new Map<GoodCode, Map<string, number>>()
  for (const bom of boms) {
    const lines = new Map<string, number>()
    for (const item of bom.items) {
      lines.set(item.materialId, (lines.get(item.materialId) ?? 0) + item.quantity.div(bom.batchSize).toNumber())
    }
    perKg.set(bom.finishedGood.code as GoodCode, lines)
  }

  return {
    cast, random, prices,
    materials:    new Map(materialRows.map(m => [m.code, { ...m, reorderPoint: m.reorderPoint.toNumber() }])),
    materialById: new Map(materialRows.map(m => [m.id, { ...m, reorderPoint: m.reorderPoint.toNumber() }])),
    perKg,
    onHand:   new Map(levels.map(l => [stockKey(l.branchId, l.materialId), l.quantity.toNumber()])),
    incoming: [],
    counts:   new Map(),
    goods,
    lots:      [],
    requests:  [],
    scheduled: [],
    lastDay,
    conversion: {
      bomId: conversionBom.id, output: 'FG-LECHON-PAKSIW', source: 'FG-LECHON',
      batchSize: conversionBom.batchSize, sourceQuantity: conversionBom.sourceQuantity,
      lines: [...conversionLines].map(([materialId, quantity]) => ({ materialId, quantity })),
    },
  }
}

/** How much of a good a branch can still use at `moment`: its lots not yet expired then. */
export function sellable(world: World, branchId: string, good: GoodCode, moment: Date): number {
  return world.lots
    .filter(lot => lot.good === good && lot.expiresAt > moment)
    .reduce((sum, lot) => sum + (lot.at.get(branchId) ?? 0), 0)
}

/** Soonest expiry first, never an expired lot — planFefoTakes' rule, on the in-memory lots. */
export function planTakes(world: World, branchId: string, good: GoodCode, quantity: number, moment: Date): { lot: Lot; quantity: number }[] {
  const takes: { lot: Lot; quantity: number }[] = []
  let remaining = Math.round(quantity * 100) / 100
  const lots = world.lots
    .filter(lot => lot.good === good && lot.expiresAt > moment && (lot.at.get(branchId) ?? 0) > 0)
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())
  for (const lot of lots) {
    if (remaining <= 0) break
    const take = Math.min(lot.at.get(branchId) ?? 0, remaining)
    takes.push({ lot, quantity: Math.round(take * 100) / 100 })
    remaining = Math.round((remaining - take) * 100) / 100
  }
  return takes.filter(take => take.quantity > 0)
}

export function moveLot(lot: Lot, branchId: string, quantity: number) {
  lot.at.set(branchId, Math.round(((lot.at.get(branchId) ?? 0) + quantity) * 100) / 100)
}

/** Rounds up to the half kilo, as people order. */
export function halfKilos(quantity: number): number {
  return Math.ceil(quantity * 2 - 1e-9) / 2
}

/** "a", "a and b", "a, b and c". */
export function listOf(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
