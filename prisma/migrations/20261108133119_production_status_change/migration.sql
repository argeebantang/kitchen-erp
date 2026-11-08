-- A new, empty table: nothing existing is altered. Orders already past DRAFT
-- before this migration have no log rows for those earlier changes; the
-- timeline falls back to the order row for them (Week 5 Task 6).

-- CreateTable
CREATE TABLE "ProductionStatusChange" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "fromStatus" "ProductionStatus" NOT NULL,
    "toStatus" "ProductionStatus" NOT NULL,
    "changedById" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionStatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionStatusChange_productionOrderId_createdAt_idx" ON "ProductionStatusChange"("productionOrderId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProductionStatusChange" ADD CONSTRAINT "ProductionStatusChange_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionStatusChange" ADD CONSTRAINT "ProductionStatusChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

