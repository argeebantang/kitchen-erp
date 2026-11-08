-- Nullable with no backfill: an order only gets a submitter when it is
-- submitted, and on 2026-11-08 every ProductionOrder row was still a DRAFT.

-- AlterTable
ALTER TABLE "ProductionOrder" ADD COLUMN     "submittedById" TEXT;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

