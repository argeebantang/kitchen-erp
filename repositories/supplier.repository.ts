import { prisma } from '@/lib/prisma'

export type SupplierRow = {
  id: string
  name: string
  contactName: string | null
  phone: string | null
  isActive: boolean
  leadTimeDays: number | null
}

export const SupplierRepository = {
  /** Minimal projection — the price panel only needs id + name for a dropdown. */
  async findAllActive(): Promise<{ id: string; name: string }[]> {
    return prisma.supplier.findMany({
      where:   { isActive: true },
      select:  { id: true, name: true },
      orderBy: { name: 'asc' },
    })
  },

  async findById(id: string): Promise<{ id: string; name: string } | null> {
    return prisma.supplier.findUnique({
      where:  { id },
      select: { id: true, name: true },
    })
  },

  /** Every supplier, active first, for Master Data → Suppliers (Week 10 Task 3). */
  async findAll(): Promise<SupplierRow[]> {
    return prisma.supplier.findMany({
      select:  { id: true, name: true, contactName: true, phone: true, isActive: true, leadTimeDays: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    })
  },

  /** The promised lead time; null clears it. False when there is no such supplier. */
  async setLeadTime(id: string, leadTimeDays: number | null): Promise<boolean> {
    const { count } = await prisma.supplier.updateMany({ where: { id }, data: { leadTimeDays } })
    return count === 1
  },

  /**
   * The lead time each supplier actually delivers in (Week 10 Task 3): per
   * purchase order approved since `since`, the Manila days from its approval
   * to its first approved receiving report — the median, and on how many
   * orders. Orders never delivered are not counted.
   */
  async measuredLeadTimes(since: Date): Promise<{ supplierId: string; samples: bigint; median: number }[]> {
    return prisma.$queryRaw`
      SELECT d."supplierId", COUNT(*) AS samples, percentile_disc(0.5) WITHIN GROUP (ORDER BY d.days) AS median
      FROM (
        SELECT po."supplierId",
               (first_rr.received AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila')::date
             - (approved.at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila')::date AS days
        FROM "PurchaseOrder" po
        JOIN LATERAL (
          SELECT MIN(a."decidedAt") AS at FROM "Approval" a
          WHERE a."referenceType" = 'PurchaseOrder' AND a."referenceId" = po.id AND a.decision = 'APPROVED'
        ) approved ON approved.at IS NOT NULL
        JOIN LATERAL (
          SELECT MIN(rr."receivedAt") AS received FROM "ReceivingReport" rr
          WHERE rr."purchaseOrderId" = po.id AND rr.status = 'APPROVED'
        ) first_rr ON first_rr.received IS NOT NULL
        WHERE po."supplierId" IS NOT NULL AND approved.at >= ${since}
      ) d
      GROUP BY d."supplierId"`
  },
}

