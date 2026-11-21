-- Week 9 Task 9: returns — an outlet sends unsold finished goods back to a
-- kitchen, as a StockTransfer of kind RETURN numbered RTN-000001.
-- StockTransfer.kind: every existing transfer is a delivery (commissary →
-- branch), so the column is added with DEFAULT 'DELIVERY' to backfill them,
-- then the default is dropped — every insert must say which kind it is, as
-- Branch.type does (Week 8 B7).

-- CreateEnum
CREATE TYPE "TransferKind" AS ENUM ('DELIVERY', 'RETURN');

-- AlterTable: add, backfill through the default, then no lasting default.
ALTER TABLE "StockTransfer" ADD COLUMN "kind" "TransferKind" NOT NULL DEFAULT 'DELIVERY';
ALTER TABLE "StockTransfer" ALTER COLUMN "kind" DROP DEFAULT;

-- Hand-written (Prisma cannot express sequences): numbers for returns,
-- RTN-000001, apart from deliveries' trf_number_seq.
CREATE SEQUENCE "rtn_number_seq";
