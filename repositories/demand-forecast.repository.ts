import { Prisma, ProductionStatus, StockRequestStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * What the Demand Forecaster (Week 10 Task 5, Feature 5) reads besides
 * finished-goods stock, recipes and the calendar: the outlets' requests to a
 * kitchen day by day, the runs already planned, and the yields the kitchen
 * has been getting. Dates are business dates, stored as midnight UTC.
 */
const dateValue = (isoDate: string) => new Date(`${isoDate}T00:00:00.000Z`)

/** One finished good asked of the kitchen for one day, across its requests. */
export type RequestedDayRow = {
  /** YYYY-MM-DD. */
  day: string
  finishedGoodId: string
  /** What the outlets asked for, whatever became of it — the demand signal. */
  asked: Prisma.Decimal
  /** What the kitchen is to send: planned for answered requests, asked for unanswered ones; declined ones count 0. */
  toSend: Prisma.Decimal
  /** Of `asked`, still SUBMITTED. */
  unanswered: Prisma.Decimal
  requests: number
}

export type PlannedRunRow = {
  id: string
  orderNumber: string
  status: ProductionStatus
  finishedGoodId: string
  plannedQty: Prisma.Decimal
}

export type YieldRow = { finishedGoodId: string; runs: number; planned: Prisma.Decimal; actual: Prisma.Decimal }

/** Statuses whose planned quantity is what the kitchen will send. */
const ANSWERED: StockRequestStatus[] = [StockRequestStatus.PLANNED, StockRequestStatus.FULFILLED, StockRequestStatus.PARTLY_FULFILLED]

export const DemandForecastRepository = {
  /**
   * Every day from `from` to `to` (both included) on which the kitchen had
   * requests, per finished good. A day with no request at all has no rows —
   * the caller tells "nothing asked" (the day has rows for other goods) from
   * "no history" (the day has none) by that.
   */
  async requestedByDay(kitchenId: string, from: string, to: string): Promise<RequestedDayRow[]> {
    const requests = await prisma.stockRequest.findMany({
      where:  { kitchenId, neededOn: { gte: dateValue(from), lte: dateValue(to) } },
      select: {
        neededOn: true, status: true,
        items: { select: { finishedGoodId: true, quantity: true, plannedQuantity: true } },
      },
    })
    const zero = new Prisma.Decimal(0)
    const rows = new Map<string, RequestedDayRow>()
    const days = new Map<string, number>()
    for (const request of requests) {
      const day = request.neededOn.toISOString().slice(0, 10)
      days.set(day, (days.get(day) ?? 0) + 1)
      for (const item of request.items) {
        const key = `${day}|${item.finishedGoodId}`
        const row = rows.get(key) ?? { day, finishedGoodId: item.finishedGoodId, asked: zero, toSend: zero, unanswered: zero, requests: 0 }
        row.asked = row.asked.add(item.quantity)
        row.requests += 1
        if (request.status === StockRequestStatus.SUBMITTED) {
          row.toSend = row.toSend.add(item.quantity)
          row.unanswered = row.unanswered.add(item.quantity)
        } else if (ANSWERED.includes(request.status)) {
          row.toSend = row.toSend.add(item.plannedQuantity ?? zero)
        }
        rows.set(key, row)
      }
    }
    return [...rows.values()]
  },

  /** Runs at the kitchen planned for the day, whatever their stage — rejected and cancelled ones aside. */
  async plannedRuns(kitchenId: string, date: string): Promise<PlannedRunRow[]> {
    return prisma.productionOrder.findMany({
      where: {
        branchId:    kitchenId,
        plannedDate: dateValue(date),
        status:      { notIn: [ProductionStatus.REJECTED, ProductionStatus.CANCELLED] },
      },
      select:  { id: true, orderNumber: true, status: true, finishedGoodId: true, plannedQty: true },
      orderBy: { orderNumber: 'asc' },
    })
  },

  /** Completed runs at the kitchen planned from `since`, per good: planned against actual output. */
  async yields(kitchenId: string, since: string): Promise<YieldRow[]> {
    const rows = await prisma.productionOrder.groupBy({
      by:     ['finishedGoodId'],
      where:  { branchId: kitchenId, status: ProductionStatus.COMPLETED, plannedDate: { gte: dateValue(since) }, actualQty: { not: null } },
      _sum:   { plannedQty: true, actualQty: true },
      _count: { _all: true },
    })
    const zero = new Prisma.Decimal(0)
    return rows.map(row => ({
      finishedGoodId: row.finishedGoodId,
      runs:           row._count._all,
      planned:        row._sum.plannedQty ?? zero,
      actual:         row._sum.actualQty ?? zero,
    }))
  },
}
