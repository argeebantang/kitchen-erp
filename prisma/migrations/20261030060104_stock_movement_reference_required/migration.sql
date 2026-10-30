-- Every stock movement names the document that caused it (referenceType +
-- referenceId). Checked first: StockMovement held 1 row, with both set, so
-- SET NOT NULL could not fail. On a table with null references it would need a
-- backfill first.

-- AlterTable
ALTER TABLE "StockMovement" ALTER COLUMN "referenceId" SET NOT NULL,
ALTER COLUMN "referenceType" SET NOT NULL;

