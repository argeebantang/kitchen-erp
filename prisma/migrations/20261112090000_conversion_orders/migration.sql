-- Week 7 Task 1: conversion orders (unsold Lechon → Lechon Paksiw).
-- * BOM gains a kind (PRODUCTION | CONVERSION) and, for a conversion recipe,
--   its source finished good and quantity per batch. The 4 existing BOMs take
--   the default PRODUCTION. Versions are now numbered per kind, so the unique
--   key and the active-version index both gain "kind".
-- * New ConversionOrder (CNV-000001 from cnv_number_seq) replaces the unused
--   Conversion stub, which had 0 rows on 2026-11-12 (the guard below refuses
--   to drop it otherwise).
-- * FinishedGoodLot.conversionOrderId links a conversion's output lot.
-- * Hand-added at the end: two CHECK constraints and the sequence, which
--   Prisma's schema language cannot express (migrate diff ignores them).

-- Guard: never drop conversion records silently.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Conversion") THEN
    RAISE EXCEPTION 'Conversion has rows: migrate them to ConversionOrder before dropping the table';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "BomKind" AS ENUM ('PRODUCTION', 'CONVERSION');

-- CreateEnum
CREATE TYPE "ConversionStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- DropForeignKey
ALTER TABLE "Conversion" DROP CONSTRAINT "Conversion_outputGoodId_fkey";

-- DropForeignKey
ALTER TABLE "Conversion" DROP CONSTRAINT "Conversion_sourceGoodId_fkey";

-- DropIndex
DROP INDEX "BOM_finishedGoodId_isActive_idx";

-- DropIndex
DROP INDEX "BOM_finishedGoodId_version_key";

-- AlterTable
ALTER TABLE "BOM" ADD COLUMN     "kind" "BomKind" NOT NULL DEFAULT 'PRODUCTION',
ADD COLUMN     "sourceFinishedGoodId" TEXT,
ADD COLUMN     "sourceQuantity" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "FinishedGoodLot" ADD COLUMN     "conversionOrderId" TEXT;

-- DropTable
DROP TABLE "Conversion";

-- CreateTable
CREATE TABLE "ConversionOrder" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "finishedGoodId" TEXT NOT NULL,
    "sourceFinishedGoodId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "status" "ConversionStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "sourceQty" DECIMAL(65,30) NOT NULL,
    "outputQty" DECIMAL(65,30) NOT NULL,
    "sourceCost" DECIMAL(65,30),
    "conversionCost" DECIMAL(65,30),
    "costPerUnit" DECIMAL(65,30),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversionOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConversionOrder_orderNumber_key" ON "ConversionOrder"("orderNumber");

-- CreateIndex
CREATE INDEX "ConversionOrder_status_idx" ON "ConversionOrder"("status");

-- CreateIndex
CREATE INDEX "ConversionOrder_branchId_idx" ON "ConversionOrder"("branchId");

-- CreateIndex
CREATE INDEX "BOM_finishedGoodId_kind_isActive_idx" ON "BOM"("finishedGoodId", "kind", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "BOM_finishedGoodId_kind_version_key" ON "BOM"("finishedGoodId", "kind", "version");

-- CreateIndex
CREATE UNIQUE INDEX "FinishedGoodLot_conversionOrderId_key" ON "FinishedGoodLot"("conversionOrderId");

-- AddForeignKey
ALTER TABLE "BOM" ADD CONSTRAINT "BOM_sourceFinishedGoodId_fkey" FOREIGN KEY ("sourceFinishedGoodId") REFERENCES "FinishedGood"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishedGoodLot" ADD CONSTRAINT "FinishedGoodLot_conversionOrderId_fkey" FOREIGN KEY ("conversionOrderId") REFERENCES "ConversionOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversionOrder" ADD CONSTRAINT "ConversionOrder_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "BOM"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversionOrder" ADD CONSTRAINT "ConversionOrder_finishedGoodId_fkey" FOREIGN KEY ("finishedGoodId") REFERENCES "FinishedGood"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversionOrder" ADD CONSTRAINT "ConversionOrder_sourceFinishedGoodId_fkey" FOREIGN KEY ("sourceFinishedGoodId") REFERENCES "FinishedGood"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversionOrder" ADD CONSTRAINT "ConversionOrder_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversionOrder" ADD CONSTRAINT "ConversionOrder_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddCheckConstraint
-- A conversion recipe names its source and a positive quantity per batch; a
-- production recipe names neither.
ALTER TABLE "BOM" ADD CONSTRAINT "BOM_kind_source_check" CHECK (
  ("kind" = 'PRODUCTION' AND "sourceFinishedGoodId" IS NULL AND "sourceQuantity" IS NULL)
  OR ("kind" = 'CONVERSION' AND "sourceFinishedGoodId" IS NOT NULL AND "sourceQuantity" > 0)
);

-- AddCheckConstraint
-- A lot comes from exactly one document: a production run or a conversion.
-- FinishedGoodLot had 0 rows on 2026-11-12.
ALTER TABLE "FinishedGoodLot" ADD CONSTRAINT "FinishedGoodLot_one_source_check" CHECK (
  num_nonnulls("productionOrderId", "conversionOrderId") = 1
);

-- CreateSequence
-- CNV-000001 numbering, same pattern as pr_ / po_ / rr_ / prd_number_seq.
CREATE SEQUENCE "cnv_number_seq";
