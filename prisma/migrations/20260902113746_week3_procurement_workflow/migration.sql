/*
  Warnings:

  - You are about to drop the column `purchaseRequestId` on the `Approval` table. All the data in the column will be lost.
  - Added the required column `referenceId` to the `Approval` table without a default value. This is not possible if the table is not empty.
  - Added the required column `referenceType` to the `Approval` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "POStatus" ADD VALUE 'PENDING_APPROVAL';
ALTER TYPE "POStatus" ADD VALUE 'APPROVED';
ALTER TYPE "POStatus" ADD VALUE 'REJECTED';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'ACCOUNTING';

-- DropForeignKey
ALTER TABLE "Approval" DROP CONSTRAINT "Approval_purchaseRequestId_fkey";

-- DropForeignKey
ALTER TABLE "PurchaseOrder" DROP CONSTRAINT "PurchaseOrder_supplierId_fkey";

-- AlterTable
ALTER TABLE "Approval" DROP COLUMN "purchaseRequestId",
ADD COLUMN     "referenceId" TEXT NOT NULL,
ADD COLUMN     "referenceType" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "PurchaseOrder" ALTER COLUMN "supplierId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Approval_referenceType_referenceId_idx" ON "Approval"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_purchaseRequestId_idx" ON "PurchaseOrder"("purchaseRequestId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_purchaseOrderId_idx" ON "PurchaseOrderItem"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseRequest_status_idx" ON "PurchaseRequest"("status");

-- CreateIndex
CREATE INDEX "PurchaseRequest_requestedById_idx" ON "PurchaseRequest"("requestedById");

-- CreateIndex
CREATE INDEX "PurchaseRequestItem_purchaseRequestId_idx" ON "PurchaseRequestItem"("purchaseRequestId");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateSequence
-- Document-number generators. nextval() is atomic under concurrent submits;
-- count()+1 is not. Prisma has no schema syntax for a standalone sequence, so
-- these are hand-added here. `prisma migrate diff` ignores standalone sequences,
-- so this introduces no drift. The app formats the value as PR-000001 / PO-000001
-- (see PurchaseRequestRepository.nextPrNumber / PurchaseOrderRepository.nextPoNumber).
CREATE SEQUENCE "pr_number_seq";
CREATE SEQUENCE "po_number_seq";
