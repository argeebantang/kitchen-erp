import { PRStatus, ProductionStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/** The counts behind the Dashboard's stat cards (Week 10 Task 7). */
export const DashboardRepository = {
  async purchaseRequestsAwaitingApproval(): Promise<number> {
    return prisma.purchaseRequest.count({ where: { status: PRStatus.PENDING_APPROVAL } })
  },

  /** Runs planned for a day (YYYY-MM-DD), by status — rejected and cancelled ones aside. */
  async runsOn(date: string): Promise<{ status: ProductionStatus; count: number }[]> {
    const rows = await prisma.productionOrder.groupBy({
      by:     ['status'],
      where:  { plannedDate: new Date(`${date}T00:00:00.000Z`), status: { notIn: [ProductionStatus.REJECTED, ProductionStatus.CANCELLED] } },
      _count: { _all: true },
    })
    return rows.map(row => ({ status: row.status, count: row._count._all }))
  },

  /** The run signed off most recently — Feature 1's latest explanation. */
  async latestCompletedRun() {
    return prisma.productionOrder.findFirst({
      where:   { status: ProductionStatus.COMPLETED, completedAt: { not: null } },
      orderBy: { completedAt: 'desc' },
      select:  { id: true, orderNumber: true, finishedGood: { select: { name: true } }, branch: { select: { name: true } } },
    })
  },
}
