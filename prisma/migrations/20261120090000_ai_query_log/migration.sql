-- Week 9 Task 4: the assistant's query log (the plan's ai_query_log).
-- AiQuery: one row per question, created PENDING before Claude is called;
-- AiCall.aiQueryId groups that question's rounds (null for other features).
-- Additive only: a new enum and table, a nullable column and its index.
-- No grant to kitchen_ai_reader — the assistant cannot read what people asked.

-- CreateEnum
CREATE TYPE "AiQueryStatus" AS ENUM ('PENDING', 'ANSWERED', 'FAILED');

-- AlterTable
ALTER TABLE "AiCall" ADD COLUMN     "aiQueryId" TEXT;

-- CreateTable
CREATE TABLE "AiQuery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "status" "AiQueryStatus" NOT NULL DEFAULT 'PENDING',
    "answer" TEXT,
    "error" TEXT,
    "lookups" JSONB NOT NULL DEFAULT '[]',
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiQuery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiQuery_createdAt_idx" ON "AiQuery"("createdAt");

-- CreateIndex
CREATE INDEX "AiQuery_userId_createdAt_idx" ON "AiQuery"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiQuery_conversationId_idx" ON "AiQuery"("conversationId");

-- CreateIndex
CREATE INDEX "AiCall_aiQueryId_idx" ON "AiCall"("aiQueryId");

-- AddForeignKey
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_aiQueryId_fkey" FOREIGN KEY ("aiQueryId") REFERENCES "AiQuery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiQuery" ADD CONSTRAINT "AiQuery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

