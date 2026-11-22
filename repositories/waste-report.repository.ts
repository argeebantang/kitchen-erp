import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * The totals behind the Waste Pattern Detector (Week 10 Task 2, Feature 3):
 * what was lost and what came in, per branch and finished good, over a
 * window. Postgres does the sums (Decimal); WastePatternService shapes them.
 * Windows are [start, end) instants; `startDate` / `endDate` are the same
 * window as business dates, for the date-only columns (soldOn, producedOn).
 */
export type WasteWindow = { start: Date; end: Date; startDate: Date; endDate: Date }

export type WriteOffTotalRow = {
  branchId: string; branchName: string; branchType: string
  finishedGoodId: string; finishedGoodName: string; unit: string
  reason: string; kg: Prisma.Decimal; value: Prisma.Decimal; writeOffs: bigint
}

export type FlowRow = {
  branchId: string; finishedGoodId: string
  /** Delivered in (an outlet) or made (a kitchen: production and conversions). */
  inKg: Prisma.Decimal | null
  /** Sent back to a kitchen (an outlet's returns). */
  returnedKg: Prisma.Decimal | null
}

export type RouteRow = {
  fromName: string; toName: string
  deliveries: bigint; withLoss: bigint
  lostKg: Prisma.Decimal | null; lostValue: Prisma.Decimal | null
  reasons: string[] | null
}

export const WasteReportRepository = {
  /** Approved write-offs recorded in the window, per branch, good and reason. */
  async writeOffs(w: WasteWindow): Promise<WriteOffTotalRow[]> {
    return prisma.$queryRaw<WriteOffTotalRow[]>`
      SELECT b.id AS "branchId", b.name AS "branchName", b.type::text AS "branchType",
             g.id AS "finishedGoodId", g.name AS "finishedGoodName", u.abbreviation AS unit,
             wo.reason::text AS reason,
             SUM(wo.quantity) AS kg, SUM(wo."totalCost") AS value, COUNT(*) AS "writeOffs"
      FROM "WriteOff" wo
      JOIN "FinishedGoodLot" l ON l.id = wo."lotId"
      JOIN "FinishedGood" g ON g.id = l."finishedGoodId"
      JOIN "Unit" u ON u.id = g."unitId"
      JOIN "Branch" b ON b.id = wo."branchId"
      WHERE wo.status = 'APPROVED' AND wo."createdAt" >= ${w.start} AND wo."createdAt" < ${w.end}
      GROUP BY b.id, b.name, b.type, g.id, g.name, u.abbreviation, wo.reason`
  },

  /** On how many Manila days each branch wrote each good off. */
  async writeOffDays(w: WasteWindow): Promise<{ branchId: string; finishedGoodId: string; days: bigint }[]> {
    return prisma.$queryRaw`
      SELECT wo."branchId", l."finishedGoodId", COUNT(DISTINCT (wo."createdAt" AT TIME ZONE 'Asia/Manila')::date) AS days
      FROM "WriteOff" wo JOIN "FinishedGoodLot" l ON l.id = wo."lotId"
      WHERE wo.status = 'APPROVED' AND wo."createdAt" >= ${w.start} AND wo."createdAt" < ${w.end}
      GROUP BY wo."branchId", l."finishedGoodId"`
  },

  /**
   * What came in and went back, per branch and good: an outlet's received
   * deliveries and its returns; a kitchen's production and conversions.
   */
  async flows(w: WasteWindow): Promise<FlowRow[]> {
    return prisma.$queryRaw<FlowRow[]>`
      SELECT m."branchId", l."finishedGoodId",
             SUM(m.quantity) FILTER (WHERE
               (m.type = 'IN' AND m."referenceType" IN ('ProductionOrder', 'ConversionOrder'))
               OR (m.type = 'TRANSFER' AND m.quantity > 0 AND t.kind = 'DELIVERY')) AS "inKg",
             -SUM(m.quantity) FILTER (WHERE m.type = 'TRANSFER' AND m.quantity < 0 AND t.kind = 'RETURN') AS "returnedKg"
      FROM "FinishedGoodMovement" m
      JOIN "FinishedGoodLot" l ON l.id = m."lotId"
      LEFT JOIN "StockTransfer" t ON m."referenceType" = 'StockTransfer' AND t.id = m."referenceId"
      WHERE m."createdAt" >= ${w.start} AND m."createdAt" < ${w.end}
      GROUP BY m."branchId", l."finishedGoodId"`
  },

  /** Sold per outlet and good (Daily Sales), by the day sold. */
  async sold(w: WasteWindow): Promise<{ branchId: string; finishedGoodId: string; kg: Prisma.Decimal }[]> {
    return prisma.$queryRaw`
      SELECT s."branchId", i."finishedGoodId", SUM(i.quantity) AS kg
      FROM "OutletSale" s JOIN "OutletSaleItem" i ON i."outletSaleId" = s.id
      WHERE s."soldOn" >= ${w.startDate} AND s."soldOn" < ${w.endDate}
      GROUP BY s."branchId", i."finishedGoodId"`
  },

  /**
   * Deliveries received in the window, per route: how many, how many arrived
   * short, the kilos and value lost (the recorded variance), and why.
   */
  async routes(w: WasteWindow): Promise<RouteRow[]> {
    return prisma.$queryRaw<RouteRow[]>`
      SELECT f.name AS "fromName", d.name AS "toName",
             COUNT(*) AS deliveries,
             COUNT(*) FILTER (WHERE t."varianceValue" > 0) AS "withLoss",
             SUM(lost.kg) AS "lostKg",
             SUM(t."varianceValue") AS "lostValue",
             ARRAY_REMOVE(ARRAY_AGG(DISTINCT t."varianceReason"::text), NULL) AS reasons
      FROM "StockTransfer" t
      JOIN "Branch" f ON f.id = t."fromBranchId"
      JOIN "Branch" d ON d.id = t."toBranchId"
      LEFT JOIN LATERAL (
        SELECT -SUM(m.quantity) FILTER (WHERE m."branchId" = t."fromBranchId") - COALESCE(SUM(m.quantity) FILTER (WHERE m."branchId" = t."toBranchId"), 0) AS kg
        FROM "FinishedGoodMovement" m WHERE m."referenceType" = 'StockTransfer' AND m."referenceId" = t.id
      ) lost ON TRUE
      WHERE t.kind = 'DELIVERY' AND t.status = 'RECEIVED' AND t."receivedAt" >= ${w.start} AND t."receivedAt" < ${w.end}
      GROUP BY f.name, d.name`
  },

  /** Approved conversions per kitchen: unsold goods turned into another dish — recovered, not lost. */
  async conversions(w: WasteWindow): Promise<{ branchName: string; count: bigint; sourceKg: Prisma.Decimal; outputKg: Prisma.Decimal; sourceName: string; outputName: string }[]> {
    return prisma.$queryRaw`
      SELECT b.name AS "branchName", COUNT(*) AS count, SUM(c."sourceQty") AS "sourceKg", SUM(c."outputQty") AS "outputKg",
             MIN(s.name) AS "sourceName", MIN(o.name) AS "outputName"
      FROM "ConversionOrder" c
      JOIN "Branch" b ON b.id = c."branchId"
      JOIN "FinishedGood" s ON s.id = c."sourceFinishedGoodId"
      JOIN "FinishedGood" o ON o.id = c."finishedGoodId"
      WHERE c.status = 'APPROVED' AND c."createdAt" >= ${w.start} AND c."createdAt" < ${w.end}
      GROUP BY b.name`
  },

  /**
   * What was produced in the window, at cost: completed runs by their lot's
   * production date, plus the ingredients conversions added — the Costing
   * dashboard's "production cost" (Week 8 Task 6).
   */
  async productionCost(w: WasteWindow): Promise<Prisma.Decimal> {
    const [row] = await prisma.$queryRaw<{ runs: Prisma.Decimal | null; conversions: Prisma.Decimal | null }[]>`
      SELECT
        (SELECT SUM(p."actualCost") FROM "ProductionOrder" p JOIN "FinishedGoodLot" l ON l."productionOrderId" = p.id
          WHERE p.status = 'COMPLETED' AND l."producedOn" >= ${w.startDate} AND l."producedOn" < ${w.endDate}) AS runs,
        (SELECT SUM(c."conversionCost") FROM "ConversionOrder" c
          WHERE c.status = 'APPROVED' AND c."createdAt" >= ${w.start} AND c."createdAt" < ${w.end}) AS conversions`
    return (row.runs ?? new Prisma.Decimal(0)).add(row.conversions ?? 0)
  },
}
