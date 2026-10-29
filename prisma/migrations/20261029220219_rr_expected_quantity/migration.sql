-- ReceivingReportItem.expectedQuantity: what was outstanding on the order line
-- when the line was counted. Variance is measured against it.
--
-- Prisma generates a single ADD COLUMN ... NOT NULL, which fails on a table
-- that already has rows. Hand-edited to the additive path: add nullable,
-- backfill, then tighten.

-- AlterTable
ALTER TABLE "ReceivingReportItem" ADD COLUMN "expectedQuantity" DECIMAL(65,30);

-- Backfill: ordered minus what OTHER approved reports accepted on the same order
-- line, floored at zero — the same figure the service computes for an open
-- report. For a report that is already approved this would also subtract
-- reports approved after it; none existed when this ran (one DRAFT, verified).
UPDATE "ReceivingReportItem" AS item
SET "expectedQuantity" = GREATEST(
  item."orderedQuantity" - COALESCE((
    SELECT SUM(other."receivedQuantity" - other."rejectedQuantity")
    FROM "ReceivingReportItem" AS other
    JOIN "ReceivingReport" AS report ON report.id = other."receivingReportId"
    WHERE other."purchaseOrderItemId" = item."purchaseOrderItemId"
      AND other."receivingReportId" <> item."receivingReportId"
      AND report.status = 'APPROVED'
  ), 0),
  0
);

ALTER TABLE "ReceivingReportItem" ALTER COLUMN "expectedQuantity" SET NOT NULL;
