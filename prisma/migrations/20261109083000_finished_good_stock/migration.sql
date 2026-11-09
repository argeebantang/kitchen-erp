-- Week 6 Task 2: finished-goods stock, kept per lot (one production run's
-- output) and branch, with its own signed ledger — the counterpart of
-- InventoryLevel / StockMovement for materials. New tables only; nothing
-- existing is altered.
--
-- FinishedGoodLot.productionOrderId is unique (one lot per run) and nullable
-- (Week 7 conversion lots have no run).

-- CreateTable
CREATE TABLE "FinishedGoodLot" (
    "id" TEXT NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "finishedGoodId" TEXT NOT NULL,
    "productionOrderId" TEXT,
    "producedOn" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinishedGoodLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinishedGoodLevel" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinishedGoodLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinishedGoodMovement" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "type" "MovementType" NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unitCost" DECIMAL(65,30),
    "referenceId" TEXT NOT NULL,
    "referenceType" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinishedGoodMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinishedGoodLot_lotNumber_key" ON "FinishedGoodLot"("lotNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FinishedGoodLot_productionOrderId_key" ON "FinishedGoodLot"("productionOrderId");

-- CreateIndex
CREATE INDEX "FinishedGoodLot_finishedGoodId_idx" ON "FinishedGoodLot"("finishedGoodId");

-- CreateIndex
CREATE INDEX "FinishedGoodLevel_branchId_idx" ON "FinishedGoodLevel"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "FinishedGoodLevel_lotId_branchId_key" ON "FinishedGoodLevel"("lotId", "branchId");

-- CreateIndex
CREATE INDEX "FinishedGoodMovement_lotId_branchId_createdAt_idx" ON "FinishedGoodMovement"("lotId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "FinishedGoodMovement_referenceType_referenceId_idx" ON "FinishedGoodMovement"("referenceType", "referenceId");

-- AddForeignKey
ALTER TABLE "FinishedGoodLot" ADD CONSTRAINT "FinishedGoodLot_finishedGoodId_fkey" FOREIGN KEY ("finishedGoodId") REFERENCES "FinishedGood"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishedGoodLot" ADD CONSTRAINT "FinishedGoodLot_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishedGoodLevel" ADD CONSTRAINT "FinishedGoodLevel_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "FinishedGoodLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishedGoodLevel" ADD CONSTRAINT "FinishedGoodLevel_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishedGoodMovement" ADD CONSTRAINT "FinishedGoodMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "FinishedGoodLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishedGoodMovement" ADD CONSTRAINT "FinishedGoodMovement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

