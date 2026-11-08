-- ProductionStatus is replaced rather than extended (PLANNED is dropped), and
-- batchWeight / batchCount are added NOT NULL with no default. Both are only
-- safe because "ProductionOrder" was verified to have 0 rows on 2026-11-07 —
-- see docs/2026-11-07-week5-production-orders.md.

-- AlterEnum
BEGIN;
CREATE TYPE "ProductionStatus_new" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
ALTER TABLE "ProductionOrder" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ProductionOrder" ALTER COLUMN "status" TYPE "ProductionStatus_new" USING ("status"::text::"ProductionStatus_new");
ALTER TYPE "ProductionStatus" RENAME TO "ProductionStatus_old";
ALTER TYPE "ProductionStatus_new" RENAME TO "ProductionStatus";
DROP TYPE "ProductionStatus_old";
ALTER TABLE "ProductionOrder" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- AlterTable
ALTER TABLE "ProductionOrder" ADD COLUMN     "batchCount" INTEGER NOT NULL,
ADD COLUMN     "batchWeight" DECIMAL(65,30) NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- CreateIndex
CREATE INDEX "ProductionOrder_status_idx" ON "ProductionOrder"("status");

-- CreateIndex
CREATE INDEX "ProductionOrder_branchId_idx" ON "ProductionOrder"("branchId");

-- CreateSequence
-- PRD-000001 numbering, same pattern as pr_ / po_ / rr_number_seq: nextval() is
-- atomic, count()+1 is not. Prisma has no schema syntax for a standalone
-- sequence and `prisma migrate diff` ignores it, so it is hand-added here and
-- causes no drift.
CREATE SEQUENCE "prd_number_seq";
