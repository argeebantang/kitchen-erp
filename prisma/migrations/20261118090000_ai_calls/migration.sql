-- Week 9 Task 1: AiCall — one row per Claude API call (feature, outcome,
-- tokens, estimated USD cost, duration) for the monthly AI budget and the AI
-- Settings page. AiFeature / AiCallOutcome enums. New table, additive only;
-- userId ON DELETE SET NULL keeps a call's cost if its user is ever removed.

-- CreateEnum
CREATE TYPE "AiFeature" AS ENUM ('CONNECTION_TEST');

-- CreateEnum
CREATE TYPE "AiCallOutcome" AS ENUM ('COMPLETED', 'REFUSED', 'MAX_TOKENS', 'ERROR', 'OVER_BUDGET');

-- CreateTable
CREATE TABLE "AiCall" (
    "id" TEXT NOT NULL,
    "feature" "AiFeature" NOT NULL,
    "outcome" "AiCallOutcome" NOT NULL,
    "model" TEXT NOT NULL,
    "servedModel" TEXT,
    "userId" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "requestId" TEXT,
    "errorType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiCall_createdAt_idx" ON "AiCall"("createdAt");

-- AddForeignKey
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

