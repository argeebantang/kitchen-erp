-- AlterTable
ALTER TABLE "BOM" ADD COLUMN     "batchSize" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "batchUnitId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "ItemPrice" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "supplierId" TEXT,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemPrice_materialId_effectiveDate_idx" ON "ItemPrice"("materialId", "effectiveDate");

-- CreateIndex
CREATE INDEX "ItemPrice_materialId_supplierId_effectiveDate_idx" ON "ItemPrice"("materialId", "supplierId", "effectiveDate");

-- CreateIndex
CREATE INDEX "BOM_finishedGoodId_isActive_idx" ON "BOM"("finishedGoodId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "BOM_finishedGoodId_version_key" ON "BOM"("finishedGoodId", "version");

-- CreateIndex
CREATE INDEX "BOMItem_bomId_idx" ON "BOMItem"("bomId");

-- CreateIndex
CREATE INDEX "Material_categoryId_idx" ON "Material"("categoryId");

-- AddForeignKey
ALTER TABLE "ItemPrice" ADD CONSTRAINT "ItemPrice_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPrice" ADD CONSTRAINT "ItemPrice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOM" ADD CONSTRAINT "BOM_batchUnitId_fkey" FOREIGN KEY ("batchUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

