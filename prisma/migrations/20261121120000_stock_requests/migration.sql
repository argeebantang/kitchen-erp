-- Week 9 Task 10: branch stock requests — an outlet asks a kitchen for finished
-- goods by a date (STR-000001). StockRequest + StockRequestItem, the
-- StockRequestStatus enum, and StockTransfer.stockRequestId (nullable: the
-- delivery sent from a request). Additive only; existing transfers keep null.

-- CreateEnum
CREATE TYPE "StockRequestStatus" AS ENUM ('SUBMITTED', 'PLANNED', 'DECLINED', 'FULFILLED', 'PARTLY_FULFILLED');

-- AlterTable
ALTER TABLE "StockTransfer" ADD COLUMN     "stockRequestId" TEXT;

-- CreateTable
CREATE TABLE "StockRequest" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "kitchenId" TEXT NOT NULL,
    "neededOn" TIMESTAMP(3) NOT NULL,
    "status" "StockRequestStatus" NOT NULL,
    "late" BOOLEAN NOT NULL,
    "submittedById" TEXT NOT NULL,
    "notes" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "kitchenNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockRequestItem" (
    "id" TEXT NOT NULL,
    "stockRequestId" TEXT NOT NULL,
    "finishedGoodId" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "plannedQuantity" DECIMAL(65,30),

    CONSTRAINT "StockRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockRequest_requestNumber_key" ON "StockRequest"("requestNumber");

-- CreateIndex
CREATE INDEX "StockRequest_status_idx" ON "StockRequest"("status");

-- CreateIndex
CREATE INDEX "StockRequest_kitchenId_neededOn_idx" ON "StockRequest"("kitchenId", "neededOn");

-- CreateIndex
CREATE INDEX "StockRequest_branchId_idx" ON "StockRequest"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "StockRequestItem_stockRequestId_finishedGoodId_key" ON "StockRequestItem"("stockRequestId", "finishedGoodId");

-- CreateIndex
CREATE INDEX "StockTransfer_stockRequestId_idx" ON "StockTransfer"("stockRequestId");

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_stockRequestId_fkey" FOREIGN KEY ("stockRequestId") REFERENCES "StockRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_kitchenId_fkey" FOREIGN KEY ("kitchenId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequestItem" ADD CONSTRAINT "StockRequestItem_stockRequestId_fkey" FOREIGN KEY ("stockRequestId") REFERENCES "StockRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequestItem" ADD CONSTRAINT "StockRequestItem_finishedGoodId_fkey" FOREIGN KEY ("finishedGoodId") REFERENCES "FinishedGood"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written (Prisma cannot express sequences): numbers for stock requests.
CREATE SEQUENCE "str_number_seq";
