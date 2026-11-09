-- Week 6 Task 3: production costing, recorded on the order when accounting
-- approves its completion. Four nullable columns, no backfill: on 2026-11-09
-- no ProductionOrder row was COMPLETED, so none had a cost to record.

-- AlterTable
ALTER TABLE "ProductionOrder" ADD COLUMN     "actualCost" DECIMAL(65,30),
ADD COLUMN     "costPerUnit" DECIMAL(65,30),
ADD COLUMN     "costVariance" DECIMAL(65,30),
ADD COLUMN     "plannedCost" DECIMAL(65,30);

