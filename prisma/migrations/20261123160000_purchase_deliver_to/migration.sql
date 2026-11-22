-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "deliverToId" TEXT;

-- AlterTable
ALTER TABLE "PurchaseRequest" ADD COLUMN     "deliverToId" TEXT;

-- CreateIndex
CREATE INDEX "PurchaseOrder_deliverToId_idx" ON "PurchaseOrder"("deliverToId");

-- CreateIndex
CREATE INDEX "PurchaseRequest_deliverToId_idx" ON "PurchaseRequest"("deliverToId");

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_deliverToId_fkey" FOREIGN KEY ("deliverToId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_deliverToId_fkey" FOREIGN KEY ("deliverToId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill (hand-written, Week 10 Task 4): the kitchen of requests and orders made before this column.
-- 1. An order: the kitchen its first delivery arrived at — what actually happened.
UPDATE "PurchaseOrder" po SET "deliverToId" = first_rr."branchId"
FROM (
  SELECT DISTINCT ON (rr."purchaseOrderId") rr."purchaseOrderId", rr."branchId"
  FROM "ReceivingReport" rr JOIN "Branch" b ON b.id = rr."branchId" AND b.type = 'COMMISSARY'
  ORDER BY rr."purchaseOrderId", rr."receivedAt"
) first_rr
WHERE po.id = first_rr."purchaseOrderId";

-- 2. A request: the kitchen its order was delivered to.
UPDATE "PurchaseRequest" pr SET "deliverToId" = po."deliverToId"
FROM (
  SELECT DISTINCT ON ("purchaseRequestId") "purchaseRequestId", "deliverToId"
  FROM "PurchaseOrder" WHERE "purchaseRequestId" IS NOT NULL AND "deliverToId" IS NOT NULL
  ORDER BY "purchaseRequestId", "createdAt"
) po
WHERE pr.id = po."purchaseRequestId";

-- 3. A request with no delivery yet: the one kitchen its notes name ("For Las Piñas Commissary — …"), if exactly one.
UPDATE "PurchaseRequest" pr SET "deliverToId" = named.id
FROM "Branch" named
WHERE pr."deliverToId" IS NULL
  AND named.type = 'COMMISSARY'
  AND position(lower(named.name) IN lower(coalesce(pr.notes, ''))) > 0
  AND (SELECT count(*) FROM "Branch" b
       WHERE b.type = 'COMMISSARY' AND position(lower(b.name) IN lower(coalesce(pr.notes, ''))) > 0) = 1;

-- 4. An order with no delivery yet: its request's kitchen.
UPDATE "PurchaseOrder" po SET "deliverToId" = pr."deliverToId"
FROM "PurchaseRequest" pr
WHERE po."deliverToId" IS NULL AND pr.id = po."purchaseRequestId" AND pr."deliverToId" IS NOT NULL;
