-- StockMovement.unitCost: purchase cost per unit on a receiving IN movement.
-- Nullable, so additive on any table; StockMovement held 0 rows when applied.

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "unitCost" DECIMAL(65,30);

