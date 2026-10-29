-- AlterEnum
BEGIN;
CREATE TYPE "RRStatus_new" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');
ALTER TABLE "ReceivingReport" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ReceivingReport" ALTER COLUMN "status" TYPE "RRStatus_new" USING ("status"::text::"RRStatus_new");
ALTER TYPE "RRStatus" RENAME TO "RRStatus_old";
ALTER TYPE "RRStatus_new" RENAME TO "RRStatus";
DROP TYPE "RRStatus_old";
ALTER TABLE "ReceivingReport" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- AlterTable
ALTER TABLE "ReceivingReport" ADD COLUMN     "branchId" TEXT NOT NULL,
ADD COLUMN     "receivedById" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ReceivingReportItem" ADD COLUMN     "purchaseOrderItemId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "branchId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "ReceivingReport_purchaseOrderId_idx" ON "ReceivingReport"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "ReceivingReport_status_idx" ON "ReceivingReport"("status");

-- CreateIndex
CREATE INDEX "ReceivingReport_branchId_idx" ON "ReceivingReport"("branchId");

-- CreateIndex
CREATE INDEX "ReceivingReportItem_receivingReportId_idx" ON "ReceivingReportItem"("receivingReportId");

-- CreateIndex
CREATE INDEX "ReceivingReportItem_purchaseOrderItemId_idx" ON "ReceivingReportItem"("purchaseOrderItemId");

-- CreateIndex
CREATE INDEX "StockMovement_materialId_branchId_createdAt_idx" ON "StockMovement"("materialId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_referenceType_referenceId_idx" ON "StockMovement"("referenceType", "referenceId");

-- AddForeignKey
ALTER TABLE "ReceivingReport" ADD CONSTRAINT "ReceivingReport_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivingReport" ADD CONSTRAINT "ReceivingReport_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivingReportItem" ADD CONSTRAINT "ReceivingReportItem_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CreateSequence
-- RR-000001 numbering, same pattern as pr_number_seq / po_number_seq in
-- 20260902113746_week3_procurement_workflow: nextval() is atomic, count()+1 is
-- not. Prisma has no schema syntax for a standalone sequence and
-- `prisma migrate diff` ignores it, so it is hand-added here and causes no drift.
CREATE SEQUENCE "rr_number_seq";
