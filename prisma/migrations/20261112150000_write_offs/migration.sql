-- Week 7 Task 2: write-offs of finished goods that cannot be used or converted.
-- New table WriteOff (one lot at one branch per write-off, WO-000001 from
-- wo_number_seq) with enums WriteOffReason and WriteOffStatus. Additive only:
-- nothing existing is altered. Hand-added at the end: the sequence, which
-- Prisma's schema language cannot express (migrate diff ignores it).

-- CreateEnum
CREATE TYPE "WriteOffReason" AS ENUM ('EXPIRED', 'SPOILED', 'DAMAGED', 'FAILED_QUALITY', 'OTHER');

-- CreateEnum
CREATE TYPE "WriteOffStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "WriteOff" (
    "id" TEXT NOT NULL,
    "writeOffNumber" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "status" "WriteOffStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "quantity" DECIMAL(65,30) NOT NULL,
    "reason" "WriteOffReason" NOT NULL,
    "notes" TEXT,
    "unitCost" DECIMAL(65,30),
    "totalCost" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WriteOff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WriteOff_writeOffNumber_key" ON "WriteOff"("writeOffNumber");

-- CreateIndex
CREATE INDEX "WriteOff_status_idx" ON "WriteOff"("status");

-- CreateIndex
CREATE INDEX "WriteOff_lotId_status_idx" ON "WriteOff"("lotId", "status");

-- CreateIndex
CREATE INDEX "WriteOff_branchId_idx" ON "WriteOff"("branchId");

-- AddForeignKey
ALTER TABLE "WriteOff" ADD CONSTRAINT "WriteOff_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "FinishedGoodLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WriteOff" ADD CONSTRAINT "WriteOff_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WriteOff" ADD CONSTRAINT "WriteOff_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CreateSequence
-- WO-000001 numbering, same pattern as pr_ / po_ / rr_ / prd_ / cnv_number_seq.
CREATE SEQUENCE "wo_number_seq";
