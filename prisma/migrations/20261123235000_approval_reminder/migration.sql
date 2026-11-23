-- Week 11 Task 3: who was reminded about which overdue approval, at which
-- 24-hour step. The unique key makes the hourly sweep remind each approver at
-- most once per document per step. Additive only.

-- CreateTable
CREATE TABLE "ApprovalReminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalReminder_userId_referenceType_referenceId_tier_key" ON "ApprovalReminder"("userId", "referenceType", "referenceId", "tier");

-- AddForeignKey
ALTER TABLE "ApprovalReminder" ADD CONSTRAINT "ApprovalReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

