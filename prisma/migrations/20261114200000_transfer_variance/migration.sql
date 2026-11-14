-- Week 8 Task 4: transfer variance. TransferVarianceReason enum; on
-- StockTransfer the value lost in transit at lot cost (recorded at receipt),
-- why, and a note. All nullable, no backfill: set together with RECEIVED
-- from now on. A transfer received before this (none exist) keeps nulls —
-- everything arrived then. Additive only.

-- CreateEnum
CREATE TYPE "TransferVarianceReason" AS ENUM ('DAMAGED', 'SPOILED', 'MISSING', 'OTHER');

-- AlterTable
ALTER TABLE "StockTransfer" ADD COLUMN     "varianceNotes" TEXT,
ADD COLUMN     "varianceReason" "TransferVarianceReason",
ADD COLUMN     "varianceValue" DECIMAL(65,30);

