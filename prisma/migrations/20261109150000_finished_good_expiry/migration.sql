-- Week 6 Task 4: shelf life on finished goods and an expiry on each lot.
-- Both nullable, no backfill: the shelf life of each finished good is a
-- business fact an admin enters in Master Data, and on 2026-11-09 no
-- FinishedGoodLot row existed.

-- AlterTable
ALTER TABLE "FinishedGood" ADD COLUMN     "shelfLifeHours" INTEGER;

-- AlterTable
ALTER TABLE "FinishedGoodLot" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "FinishedGoodLot_expiresAt_idx" ON "FinishedGoodLot"("expiresAt");

