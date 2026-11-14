-- Week 8 Task 3: who confirmed a transfer arrived, and when (R3). Both
-- nullable — set together with status RECEIVED — so no backfill: existing
-- rows are not RECEIVED (none are; Task 2 creates PENDING_APPROVAL only). Additive.

-- AlterTable
ALTER TABLE "StockTransfer" ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "receivedById" TEXT;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

