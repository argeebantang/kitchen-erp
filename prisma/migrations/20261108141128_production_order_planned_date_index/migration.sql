-- For the production schedule calendar, which reads orders by plannedDate
-- range (Week 5 Task 7). A plain index on a small table: no lock concern.

-- CreateIndex
CREATE INDEX "ProductionOrder_plannedDate_idx" ON "ProductionOrder"("plannedDate");

