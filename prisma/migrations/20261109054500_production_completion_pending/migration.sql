-- Week 6 Task 1: the kitchen reports a run done with its actual yield and the
-- order waits for accounting to sign the completion off (stock moves then,
-- Task 2). Additive only.
--
-- AFTER 'IN_PROGRESS' is hand-added (Prisma appends new values at the end) so
-- the database lists the statuses in workflow order, as the schema does.
-- completedById is nullable with no backfill: on 2026-11-09 every
-- ProductionOrder row was still a DRAFT, so none had been completed.

-- AlterEnum
ALTER TYPE "ProductionStatus" ADD VALUE 'PENDING_COMPLETION' AFTER 'IN_PROGRESS';

-- AlterTable
ALTER TABLE "ProductionOrder" ADD COLUMN     "completedById" TEXT;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
