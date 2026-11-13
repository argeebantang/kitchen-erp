-- Week 8 Task 1: branch profiles. Branch gains code (unique short label), type
-- (COMMISSARY supplies, OUTLET receives — every branch cooks), phone,
-- managerId (unique FK to User: one manager per branch, one branch per
-- manager) and updatedAt; name becomes unique.
--
-- Hand-edited from `prisma migrate diff`: the table has a row (Main
-- Commissary), so code, type and updatedAt are added nullable, backfilled,
-- then made NOT NULL. type gets no lasting default — every new branch must
-- choose one.

-- CreateEnum
CREATE TYPE "BranchType" AS ENUM ('COMMISSARY', 'OUTLET');

-- AlterTable: nullable first
ALTER TABLE "Branch" ADD COLUMN     "code" TEXT,
ADD COLUMN     "managerId" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "type" "BranchType",
ADD COLUMN     "updatedAt" TIMESTAMP(3);

-- Backfill. Main Commissary (the seeded branch) is MAIN; any other existing
-- branch gets B + its row number so the unique index below cannot fail. All
-- existing branches are commissaries: they are where deliveries and
-- production have happened so far.
UPDATE "Branch" b
SET "code" = CASE WHEN b."name" = 'Main Commissary' THEN 'MAIN' ELSE 'B' || n.rn END,
    "type" = 'COMMISSARY',
    "updatedAt" = CURRENT_TIMESTAMP
FROM (SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS rn FROM "Branch") n
WHERE n."id" = b."id";

-- Then required
ALTER TABLE "Branch" ALTER COLUMN "code" SET NOT NULL,
ALTER COLUMN "type" SET NOT NULL,
ALTER COLUMN "updatedAt" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Branch_name_key" ON "Branch"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_managerId_key" ON "Branch"("managerId");

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
