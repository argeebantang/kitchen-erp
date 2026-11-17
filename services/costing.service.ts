import { Prisma, WriteOffReason } from '@prisma/client'
import { toDecimalString } from '@/lib/decimal'
import { addDays, businessDayRange, isoDateAt, todayIsoDate, weekStartOf } from '@/lib/dates'
import { ProductionOrderRepository } from '@/repositories/production-order.repository'
import { ConversionOrderRepository } from '@/repositories/conversion-order.repository'
import { WriteOffRepository } from '@/repositories/write-off.repository'
import { StockTransferRepository } from '@/repositories/stock-transfer.repository'
import { SOURCE_PAGES } from '@/services/inventory.service'

/**
 * The costing dashboard (Week 8 Task 6): what production cost and what was
 * lost, week by week, read from the costs recorded at sign-off — never
 * recomputed, nothing stored (C13). Weeks run Monday to Sunday, Manila (C3).
 *
 * A figure belongs to the week it happened in, counted once signed off (C4):
 * a batch or conversion by its lot's production date, a write-off by the day
 * it was recorded, a transfer shortfall by the day it was received.
 */

/** The ?weeks= choices (C5), the current week included. */
export const COSTING_RANGES = [4, 12, 26, 52] as const
export type CostingRange = (typeof COSTING_RANGES)[number]
export const DEFAULT_COSTING_RANGE: CostingRange = 12

export function isCostingRange(value: number): value is CostingRange {
  return COSTING_RANGES.some(range => range === value)
}

export type CostingViewer = { userId: string; role: string }

/** How many of the most expensive batches the dashboard lists (C9). */
export const EXPENSIVE_BATCH_LIMIT = 10

/** What production cost and what was lost over a span. Pesos as Decimal strings, unrounded. */
export type CostingFiguresDto = {
  /** Σ actualCost of the signed-off runs. */
  batches: string
  batchCount: number
  /** Σ conversionCost: ingredients added in conversions. The source was already counted as a batch. */
  conversion: string
  conversionCount: number
  /** batches + conversion — "production cost" (C6). */
  production: string
  writeOffs: Record<WriteOffReason, string>
  writeOffTotal: string
  writeOffCount: number
  /** Σ varianceValue of transfers received short (C11). */
  transferLoss: string
  shortTransferCount: number
  /** Short transfers whose lots had no cost, so they add nothing to transferLoss. */
  unvaluedShortTransfers: number
  /** writeOffTotal + transferLoss. */
  lost: string
  /** lost ÷ production × 100 to one place; null when nothing was produced. */
  lostPercent: string | null
}

/** One business week's figures. */
export type CostingWeekDto = CostingFiguresDto & {
  /** Monday, YYYY-MM-DD. */
  start: string
  /** Sunday, YYYY-MM-DD. */
  end: string
  /** The week today is in — still filling up. */
  isCurrent: boolean
}

export type CostingDashboardDto = {
  range: CostingRange
  /** Oldest first; the last is the current week. */
  weeks: CostingWeekDto[]
  thisWeek: CostingWeekDto
  lastWeek: CostingWeekDto
  /** The whole range. */
  totals: CostingFiguresDto
  /** Each finished good made in the range, by name. */
  goods: CostPerGoodDto[]
  /** The range's costliest signed-off runs, most expensive first (C9). */
  expensiveBatches: ExpensiveBatchDto[]
  /** Recorded in the range but not signed off, so not in any figure yet (C4). */
  awaiting: { batches: number; conversions: number; writeOffs: number }
}

/** One signed-off production run, by what it cost (C9). Pesos and quantities as Decimal strings. */
export type ExpensiveBatchDto = {
  id: string
  orderNumber: string
  /** The order page, for roles that may open it (SOURCE_PAGES); null otherwise. */
  href: string | null
  finishedGoodName: string
  unitAbbreviation: string
  branchName: string
  /** YYYY-MM-DD: the lot's production date. */
  producedOn: string
  quantity: string
  cost: string
  costPerUnit: string
  /** Beyond what that much should have cost at plan; positive = over. */
  costVariance: string
}

/** What one unit of a good cost in one week: Σ cost ÷ Σ quantity made. */
export type GoodWeekDto = {
  /** Null when none was made that week — a gap, never a zero (C8). */
  costPerUnit: string | null
  /** Made that week, in the good's unit. */
  quantity: string
}

/**
 * Cost per unit of one finished good over the range (C8), weighted by
 * quantity so a small batch counts for less than a big one. Batches cost
 * their actualCost; conversion output costs the source it used plus the
 * ingredients it added.
 */
export type CostPerGoodDto = {
  finishedGoodId: string
  code: string
  name: string
  unitAbbreviation: string
  /** One per dashboard week, in the same order. */
  weeks: GoodWeekDto[]
  /** Over the whole range. */
  average: string
  quantity: string
  /** The earliest and latest weeks it was made, and the change between them; null change when they are the same week. */
  first: { start: string; costPerUnit: string }
  latest: { start: string; costPerUnit: string }
  changePercent: string | null
}

const ZERO = new Prisma.Decimal(0)

type WeekTotals = {
  start: string
  batches: Prisma.Decimal
  batchCount: number
  conversion: Prisma.Decimal
  conversionCount: number
  writeOffs: Record<WriteOffReason, Prisma.Decimal>
  writeOffCount: number
  transferLoss: Prisma.Decimal
  shortTransferCount: number
  unvaluedShortTransfers: number
}

/** One value per write-off reason; the type makes a new reason a compile error here. */
function byReason<T>(value: (reason: WriteOffReason) => T): Record<WriteOffReason, T> {
  return {
    EXPIRED:        value(WriteOffReason.EXPIRED),
    SPOILED:        value(WriteOffReason.SPOILED),
    DAMAGED:        value(WriteOffReason.DAMAGED),
    FAILED_QUALITY: value(WriteOffReason.FAILED_QUALITY),
    OTHER:          value(WriteOffReason.OTHER),
  }
}

function emptyWeek(start: string): WeekTotals {
  return {
    start,
    batches:                ZERO,
    batchCount:             0,
    conversion:             ZERO,
    conversionCount:        0,
    writeOffs:              byReason(() => ZERO),
    writeOffCount:          0,
    transferLoss:           ZERO,
    shortTransferCount:     0,
    unvaluedShortTransfers: 0,
  }
}

/** The range's totals: every week added up. */
function sumWeeks(weeks: WeekTotals[], start: string): WeekTotals {
  return weeks.reduce<WeekTotals>((sum, week) => ({
    start,
    batches:                sum.batches.plus(week.batches),
    batchCount:             sum.batchCount + week.batchCount,
    conversion:             sum.conversion.plus(week.conversion),
    conversionCount:        sum.conversionCount + week.conversionCount,
    writeOffs:              byReason(reason => sum.writeOffs[reason].plus(week.writeOffs[reason])),
    writeOffCount:          sum.writeOffCount + week.writeOffCount,
    transferLoss:           sum.transferLoss.plus(week.transferLoss),
    shortTransferCount:     sum.shortTransferCount + week.shortTransferCount,
    unvaluedShortTransfers: sum.unvaluedShortTransfers + week.unvaluedShortTransfers,
  }), emptyWeek(start))
}

function toFiguresDto(week: WeekTotals): CostingFiguresDto {
  const production    = week.batches.plus(week.conversion)
  const writeOffTotal = Object.values(week.writeOffs).reduce((sum, value) => sum.plus(value), ZERO)
  const lost          = writeOffTotal.plus(week.transferLoss)

  return {
    batches:                toDecimalString(week.batches),
    batchCount:             week.batchCount,
    conversion:             toDecimalString(week.conversion),
    conversionCount:        week.conversionCount,
    production:             toDecimalString(production),
    writeOffs:              byReason(reason => toDecimalString(week.writeOffs[reason])),
    writeOffTotal:          toDecimalString(writeOffTotal),
    writeOffCount:          week.writeOffCount,
    transferLoss:           toDecimalString(week.transferLoss),
    shortTransferCount:     week.shortTransferCount,
    unvaluedShortTransfers: week.unvaluedShortTransfers,
    lost:                   toDecimalString(lost),
    lostPercent:            production.isZero() ? null : toDecimalString(lost.div(production).times(100).toDecimalPlaces(1)),
  }
}

function toWeekDto(week: WeekTotals, currentStart: string): CostingWeekDto {
  return {
    ...toFiguresDto(week),
    start:     week.start,
    end:       addDays(week.start, 6),
    isCurrent: week.start === currentStart,
  }
}

type GoodTotals = {
  finishedGoodId: string
  code: string
  name: string
  unitAbbreviation: string
  cost: Prisma.Decimal[]
  quantity: Prisma.Decimal[]
}

function toGoodDto(good: GoodTotals, starts: string[]): CostPerGoodDto | null {
  const made = starts
    .map((start, index) => ({ start, cost: good.cost[index], quantity: good.quantity[index] }))
    .filter(week => week.quantity.gt(0))
  if (made.length === 0) return null

  const perUnit = (cost: Prisma.Decimal, quantity: Prisma.Decimal) => cost.div(quantity)
  const totalCost     = made.reduce((sum, week) => sum.plus(week.cost), ZERO)
  const totalQuantity = made.reduce((sum, week) => sum.plus(week.quantity), ZERO)
  const first  = made[0]
  const latest = made[made.length - 1]
  const firstCost  = perUnit(first.cost, first.quantity)
  const latestCost = perUnit(latest.cost, latest.quantity)

  return {
    finishedGoodId:   good.finishedGoodId,
    code:             good.code,
    name:             good.name,
    unitAbbreviation: good.unitAbbreviation,
    weeks:            starts.map((_, index) => ({
      costPerUnit: good.quantity[index].gt(0) ? toDecimalString(perUnit(good.cost[index], good.quantity[index])) : null,
      quantity:    toDecimalString(good.quantity[index]),
    })),
    average:       toDecimalString(perUnit(totalCost, totalQuantity)),
    quantity:      toDecimalString(totalQuantity),
    first:         { start: first.start, costPerUnit: toDecimalString(firstCost) },
    latest:        { start: latest.start, costPerUnit: toDecimalString(latestCost) },
    changePercent: made.length === 1 || firstCost.isZero()
      ? null
      : toDecimalString(latestCost.minus(firstCost).div(firstCost).times(100).toDecimalPlaces(1)),
  }
}

/** A date-only column (UTC midnight) as its YYYY-MM-DD label. */
function dateLabel(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export const CostingService = {
  async dashboard(range: CostingRange, viewer: CostingViewer): Promise<CostingDashboardDto> {
    const currentStart = weekStartOf(todayIsoDate())
    const firstStart   = addDays(currentStart, -7 * (range - 1))
    const endExclusive = addDays(currentStart, 7)

    const weeks = Array.from({ length: range }, (_, index) => emptyWeek(addDays(firstStart, 7 * index)))
    const byStart = new Map(weeks.map(week => [week.start, week]))
    const weekOf = (date: string) => byStart.get(weekStartOf(date))
    const starts = weeks.map(week => week.start)

    // Cost and quantity made per good per week, for cost per unit (C8).
    const goods = new Map<string, GoodTotals>()
    const addMade = (
      good: { id: string; code: string; name: string; unit: { abbreviation: string } },
      start: string,
      cost: Prisma.Decimal,
      quantity: Prisma.Decimal,
    ) => {
      const index = starts.indexOf(start)
      if (index < 0) return
      let totals = goods.get(good.id)
      if (!totals) {
        totals = {
          finishedGoodId:   good.id,
          code:             good.code,
          name:             good.name,
          unitAbbreviation: good.unit.abbreviation,
          cost:             starts.map(() => ZERO),
          quantity:         starts.map(() => ZERO),
        }
        goods.set(good.id, totals)
      }
      totals.cost[index]     = totals.cost[index].plus(cost)
      totals.quantity[index] = totals.quantity[index].plus(quantity)
    }

    // Lots are dated by label (UTC midnight); write-offs and receipts are
    // moments, bounded by Manila midnights.
    const fromLabel = new Date(`${firstStart}T00:00:00Z`)
    const toLabel   = new Date(`${endExclusive}T00:00:00Z`)
    const fromMoment = businessDayRange(firstStart).start
    const toMoment   = businessDayRange(endExclusive).start

    const [runs, conversions, writeOffs, shortTransfers, awaitingBatches, awaitingConversions, awaitingWriteOffs] = await Promise.all([
      ProductionOrderRepository.findCompletedProducedBetween(fromLabel, toLabel),
      ConversionOrderRepository.findApprovedProducedBetween(fromLabel, toLabel),
      WriteOffRepository.findApprovedRecordedBetween(fromMoment, toMoment),
      StockTransferRepository.findReceivedShortBetween(fromMoment, toMoment),
      // Each will be dated by the day it was reported or recorded once
      // approved, so these are the ones that will land in this range.
      ProductionOrderRepository.countAwaitingCompletionBetween(fromMoment, toMoment),
      ConversionOrderRepository.countPendingRecordedBetween(fromMoment, toMoment),
      WriteOffRepository.countPendingRecordedBetween(fromMoment, toMoment),
    ])

    for (const run of runs) {
      const week = run.lot && weekOf(dateLabel(run.lot.producedOn))
      if (!week) continue
      week.batches = week.batches.plus(run.actualCost ?? ZERO)
      week.batchCount += 1
      if (run.actualCost !== null && run.actualQty !== null) addMade(run.finishedGood, week.start, run.actualCost, run.actualQty)
    }

    for (const conversion of conversions) {
      const week = conversion.lot && weekOf(dateLabel(conversion.lot.producedOn))
      if (!week) continue
      week.conversion = week.conversion.plus(conversion.conversionCost ?? ZERO)
      week.conversionCount += 1
      // The output lot's cost is what it was made from plus what was added.
      if (conversion.sourceCost !== null && conversion.conversionCost !== null) {
        addMade(conversion.finishedGood, week.start, conversion.sourceCost.plus(conversion.conversionCost), conversion.outputQty)
      }
    }

    for (const writeOff of writeOffs) {
      const week = weekOf(isoDateAt(writeOff.createdAt))
      if (!week) continue
      week.writeOffs[writeOff.reason] = week.writeOffs[writeOff.reason].plus(writeOff.totalCost ?? ZERO)
      week.writeOffCount += 1
    }

    for (const transfer of shortTransfers) {
      const week = transfer.receivedAt && weekOf(isoDateAt(transfer.receivedAt))
      if (!week) continue
      if (transfer.varianceValue === null) week.unvaluedShortTransfers += 1
      else week.transferLoss = week.transferLoss.plus(transfer.varianceValue)
      week.shortTransferCount += 1
    }

    const orderPage = SOURCE_PAGES.ProductionOrder
    const canOpenOrders = orderPage.roles.includes(viewer.role)
    const expensiveBatches = runs
      .flatMap(run => {
        const { lot, actualCost, actualQty, costPerUnit, costVariance } = run
        if (!lot || actualCost === null || actualQty === null || costPerUnit === null || costVariance === null) return []
        return [{ run, lot, actualCost, actualQty, costPerUnit, costVariance }]
      })
      // Most expensive first; between equals, the more recent.
      .sort((a, b) => b.actualCost.comparedTo(a.actualCost) || b.lot.producedOn.getTime() - a.lot.producedOn.getTime())
      .slice(0, EXPENSIVE_BATCH_LIMIT)
      .map<ExpensiveBatchDto>(({ run, lot, actualCost, actualQty, costPerUnit, costVariance }) => ({
        id:               run.id,
        orderNumber:      run.orderNumber,
        href:             canOpenOrders ? orderPage.href(run.id) : null,
        finishedGoodName: run.finishedGood.name,
        unitAbbreviation: run.finishedGood.unit.abbreviation,
        branchName:       run.branch.name,
        producedOn:       dateLabel(lot.producedOn),
        quantity:         toDecimalString(actualQty),
        cost:             toDecimalString(actualCost),
        costPerUnit:      toDecimalString(costPerUnit),
        costVariance:     toDecimalString(costVariance),
      }))

    const dtos = weeks.map(week => toWeekDto(week, currentStart))
    return {
      range,
      weeks:    dtos,
      thisWeek: dtos[dtos.length - 1],
      lastWeek: dtos[dtos.length - 2],
      totals:   toFiguresDto(sumWeeks(weeks, firstStart)),
      goods:    [...goods.values()]
        .map(good => toGoodDto(good, starts))
        .filter(good => good !== null)
        .sort((a, b) => a.name.localeCompare(b.name)),
      expensiveBatches,
      awaiting: { batches: awaitingBatches, conversions: awaitingConversions, writeOffs: awaitingWriteOffs },
    }
  },
}
