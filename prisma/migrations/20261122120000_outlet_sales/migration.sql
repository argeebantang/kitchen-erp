-- CreateTable
CREATE TABLE "OutletSale" (
    "id" TEXT NOT NULL,
    "saleNumber" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "soldOn" TIMESTAMP(3) NOT NULL,
    "submittedById" TEXT NOT NULL,
    "notes" TEXT,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "totalCost" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutletSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutletSaleItem" (
    "id" TEXT NOT NULL,
    "outletSaleId" TEXT NOT NULL,
    "finishedGoodId" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "OutletSaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutletSale_saleNumber_key" ON "OutletSale"("saleNumber");

-- CreateIndex
CREATE INDEX "OutletSale_soldOn_idx" ON "OutletSale"("soldOn");

-- CreateIndex
CREATE UNIQUE INDEX "OutletSale_branchId_soldOn_key" ON "OutletSale"("branchId", "soldOn");

-- CreateIndex
CREATE UNIQUE INDEX "OutletSaleItem_outletSaleId_finishedGoodId_key" ON "OutletSaleItem"("outletSaleId", "finishedGoodId");

-- AddForeignKey
ALTER TABLE "OutletSale" ADD CONSTRAINT "OutletSale_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletSale" ADD CONSTRAINT "OutletSale_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletSaleItem" ADD CONSTRAINT "OutletSaleItem_outletSaleId_fkey" FOREIGN KEY ("outletSaleId") REFERENCES "OutletSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletSaleItem" ADD CONSTRAINT "OutletSaleItem_finishedGoodId_fkey" FOREIGN KEY ("finishedGoodId") REFERENCES "FinishedGood"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SLS-000001 numbers (Week 10 Task 1), like every other document number.
CREATE SEQUENCE "sls_number_seq";

-- The assistant's read-only login may read sales, like the other stock
-- documents (a new table is not readable until a migration grants it).
GRANT SELECT ON "OutletSale", "OutletSaleItem" TO kitchen_ai_reader;
