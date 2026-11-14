-- Week 8 Task 2: Transfer Orders. The Week 1 StockTransfer / StockTransferItem
-- (raw materials, no number, status or submitter) were never used; they are
-- reshaped in place for finished goods: transferNumber (TRF-000001, from
-- trf_number_seq), status (TransferStatus), submittedById, updatedAt; a line
-- is a finished good + quantity, one per good. transferredAt goes — Task 3
-- records dispatch and receipt on the status flow.
--
-- NOT NULL columns are added directly because both tables are empty (checked
-- 2026-11-14); the DO block stops the migration if that is ever not so.
-- Hand-added at the end: the guard, the sequence and two CHECKs, which
-- Prisma's schema language cannot express (migrate diff ignores them).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "StockTransfer") OR EXISTS (SELECT 1 FROM "StockTransferItem") THEN
    RAISE EXCEPTION 'StockTransfer / StockTransferItem have rows: this migration assumes they are empty';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'RECEIVED', 'REJECTED');

-- DropForeignKey
ALTER TABLE "StockTransferItem" DROP CONSTRAINT "StockTransferItem_materialId_fkey";

-- DropForeignKey
ALTER TABLE "StockTransferItem" DROP CONSTRAINT "StockTransferItem_stockTransferId_fkey";

-- AlterTable
ALTER TABLE "StockTransfer" DROP COLUMN "transferredAt",
ADD COLUMN     "status" "TransferStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
ADD COLUMN     "submittedById" TEXT NOT NULL,
ADD COLUMN     "transferNumber" TEXT NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "StockTransferItem" DROP COLUMN "materialId",
ADD COLUMN     "finishedGoodId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_transferNumber_key" ON "StockTransfer"("transferNumber");

-- CreateIndex
CREATE INDEX "StockTransfer_status_idx" ON "StockTransfer"("status");

-- CreateIndex
CREATE INDEX "StockTransfer_fromBranchId_idx" ON "StockTransfer"("fromBranchId");

-- CreateIndex
CREATE INDEX "StockTransfer_toBranchId_idx" ON "StockTransfer"("toBranchId");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransferItem_stockTransferId_finishedGoodId_key" ON "StockTransferItem"("stockTransferId", "finishedGoodId");

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_stockTransferId_fkey" FOREIGN KEY ("stockTransferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_finishedGoodId_fkey" FOREIGN KEY ("finishedGoodId") REFERENCES "FinishedGood"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Document numbers, like pr/po/rr/prd/cnv/wo_number_seq.
CREATE SEQUENCE "trf_number_seq";

-- A line sends something; a transfer goes somewhere else.
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_quantity_positive_check" CHECK ("quantity" > 0);
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_branches_differ_check" CHECK ("fromBranchId" <> "toBranchId");
