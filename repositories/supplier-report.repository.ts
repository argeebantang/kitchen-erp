import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * The totals behind the Supplier Performance Analyzer (Week 10 Task 3,
 * Feature 6): one month of receiving, per supplier — Postgres does the sums
 * (Decimal); SupplierPerformanceService shapes and judges them. A window is
 * [start, end) as instants. Days are Manila dates.
 */
export type MonthWindow = { start: Date; end: Date }

export type DeliveryTotalsRow = {
  supplierId: string; supplierName: string
  deliveries: bigint; orders: bigint
  lines: bigint; shortLines: bigint; shortDeliveries: bigint
  shortValue: Prisma.Decimal | null
  rejectedLines: bigint; rejectedValue: Prisma.Decimal | null
  receivedValue: Prisma.Decimal | null
}

export type MaterialShortRow = {
  supplierId: string; supplierName: string; materialName: string; unit: string
  lines: bigint; shortLines: bigint; shortQty: Prisma.Decimal | null; shortValue: Prisma.Decimal | null
}

export type TimelinessRow = {
  supplierId: string
  /** Orders whose first delivery fell in the window. */
  orders: bigint
  late: bigint
  /** Average and most days late, among the late ones. */
  avgDaysLate: Prisma.Decimal | null
  maxDaysLate: number | null
  /** Median days from approval to the first delivery, over those orders. */
  medianLeadTime: number | null
  /** Of those orders, how many still miss part of what was ordered (short, never made good). */
  unfilledOrders: bigint
  unfilledValue: Prisma.Decimal | null
}

/** Every receiving line approved in the window, with its supplier. */
const LINES = (w: MonthWindow) => Prisma.sql`
  SELECT po."supplierId", s.name AS "supplierName", rr.id AS "rrId", po.id AS "poId",
         ri."materialId", ri."expectedQuantity" AS expected, ri."receivedQuantity" AS received,
         ri."rejectedQuantity" AS rejected, ri."unitCost"
  FROM "ReceivingReport" rr
  JOIN "PurchaseOrder" po ON po.id = rr."purchaseOrderId"
  JOIN "Supplier" s ON s.id = po."supplierId"
  JOIN "ReceivingReportItem" ri ON ri."receivingReportId" = rr.id
  WHERE rr.status = 'APPROVED' AND rr."receivedAt" >= ${w.start} AND rr."receivedAt" < ${w.end}`

export const SupplierReportRepository = {
  async deliveries(w: MonthWindow): Promise<DeliveryTotalsRow[]> {
    return prisma.$queryRaw<DeliveryTotalsRow[]>`
      WITH l AS (${LINES(w)}),
           per_rr AS (SELECT "rrId", "supplierId", bool_or(received < expected) AS short FROM l GROUP BY "rrId", "supplierId")
      SELECT l."supplierId", MIN(l."supplierName") AS "supplierName",
             COUNT(DISTINCT l."rrId") AS deliveries, COUNT(DISTINCT l."poId") AS orders,
             COUNT(*) AS lines,
             COUNT(*) FILTER (WHERE l.received < l.expected) AS "shortLines",
             (SELECT COUNT(*) FROM per_rr p WHERE p."supplierId" = l."supplierId" AND p.short) AS "shortDeliveries",
             SUM((l.expected - l.received) * l."unitCost") FILTER (WHERE l.received < l.expected) AS "shortValue",
             COUNT(*) FILTER (WHERE l.rejected > 0) AS "rejectedLines",
             SUM(l.rejected * l."unitCost") FILTER (WHERE l.rejected > 0) AS "rejectedValue",
             SUM((l.received - l.rejected) * l."unitCost") AS "receivedValue"
      FROM l GROUP BY l."supplierId"`
  },

  /** Per supplier and material, the lines that came short. */
  async materialShorts(w: MonthWindow): Promise<MaterialShortRow[]> {
    return prisma.$queryRaw<MaterialShortRow[]>`
      WITH l AS (${LINES(w)})
      SELECT l."supplierId", MIN(l."supplierName") AS "supplierName", m.name AS "materialName", u.abbreviation AS unit,
             COUNT(*) AS lines, COUNT(*) FILTER (WHERE l.received < l.expected) AS "shortLines",
             SUM(l.expected - l.received) FILTER (WHERE l.received < l.expected) AS "shortQty",
             SUM((l.expected - l.received) * l."unitCost") FILTER (WHERE l.received < l.expected) AS "shortValue"
      FROM l JOIN "Material" m ON m.id = l."materialId" JOIN "Unit" u ON u.id = m."unitId"
      GROUP BY l."supplierId", m.name, u.abbreviation
      HAVING COUNT(*) FILTER (WHERE l.received < l.expected) > 0`
  },

  /**
   * Per supplier, the orders first delivered in the window: late against the
   * promised date (expectedDelivery), by how many days, the lead time, and
   * which still miss part of the order.
   */
  async timeliness(w: MonthWindow): Promise<TimelinessRow[]> {
    return prisma.$queryRaw<TimelinessRow[]>`
      WITH o AS (
        SELECT po.id, po."supplierId",
               (first_rr.at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila')::date - po."expectedDelivery"::date AS late_by,
               (first_rr.at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila')::date - (approved.at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila')::date AS lead_time,
               outstanding.value AS unfilled
        FROM "PurchaseOrder" po
        JOIN LATERAL (SELECT MIN(rr."receivedAt") AS at FROM "ReceivingReport" rr WHERE rr."purchaseOrderId" = po.id AND rr.status = 'APPROVED') first_rr ON TRUE
        JOIN LATERAL (SELECT MIN(a."decidedAt") AS at FROM "Approval" a WHERE a."referenceType" = 'PurchaseOrder' AND a."referenceId" = po.id AND a.decision = 'APPROVED') approved ON TRUE
        LEFT JOIN LATERAL (
          SELECT SUM((poi.quantity - COALESCE(acc.qty, 0)) * poi."unitCost") AS value
          FROM "PurchaseOrderItem" poi
          LEFT JOIN LATERAL (
            SELECT SUM(ri."receivedQuantity" - ri."rejectedQuantity") AS qty FROM "ReceivingReportItem" ri
            JOIN "ReceivingReport" rr ON rr.id = ri."receivingReportId" AND rr.status = 'APPROVED'
            WHERE ri."purchaseOrderItemId" = poi.id
          ) acc ON TRUE
          WHERE poi."purchaseOrderId" = po.id AND poi.quantity > COALESCE(acc.qty, 0)
        ) outstanding ON TRUE
        WHERE po."supplierId" IS NOT NULL AND po."expectedDelivery" IS NOT NULL
          AND first_rr.at >= ${w.start} AND first_rr.at < ${w.end}
      )
      SELECT "supplierId", COUNT(*) AS orders,
             COUNT(*) FILTER (WHERE late_by > 0) AS late,
             AVG(late_by) FILTER (WHERE late_by > 0) AS "avgDaysLate",
             MAX(late_by) FILTER (WHERE late_by > 0) AS "maxDaysLate",
             percentile_disc(0.5) WITHIN GROUP (ORDER BY lead_time) AS "medianLeadTime",
             COUNT(*) FILTER (WHERE unfilled > 0) AS "unfilledOrders",
             SUM(unfilled) FILTER (WHERE unfilled > 0) AS "unfilledValue"
      FROM o GROUP BY "supplierId"`
  },
}
