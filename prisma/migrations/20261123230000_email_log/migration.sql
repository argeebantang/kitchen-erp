-- Week 11 Task 2: email via Resend. User.notificationEmail is where the
-- app emails a user (apart from the login email); EmailLog records each email
-- sent, skipped or failed. Additive only.

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('SENT', 'SKIPPED', 'FAILED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notificationEmail" TEXT;

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL,
    "userId" TEXT,
    "notificationId" TEXT,
    "toAddress" TEXT,
    "subject" TEXT NOT NULL,
    "providerId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailLog_notificationId_idx" ON "EmailLog"("notificationId");

-- CreateIndex
CREATE INDEX "EmailLog_createdAt_idx" ON "EmailLog"("createdAt");

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

