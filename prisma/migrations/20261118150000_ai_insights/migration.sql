-- Week 9 Task 2: AiInsight — stored AI output about one record (the plan's
-- ai_insights), first used by the Cost Variance Explainer. AiInsightType /
-- AiInsightStatus enums; AiFeature gains COST_VARIANCE (not used in this
-- migration, so ADD VALUE inside its transaction is safe). New table,
-- additive only; aiCallId ON DELETE SET NULL.

-- CreateEnum
CREATE TYPE "AiInsightType" AS ENUM ('COST_VARIANCE');

-- CreateEnum
CREATE TYPE "AiInsightStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- AlterEnum
ALTER TYPE "AiFeature" ADD VALUE 'COST_VARIANCE';

-- CreateTable
CREATE TABLE "AiInsight" (
    "id" TEXT NOT NULL,
    "type" "AiInsightType" NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "status" "AiInsightStatus" NOT NULL DEFAULT 'PENDING',
    "content" TEXT,
    "facts" JSONB,
    "prompt" TEXT,
    "model" TEXT,
    "aiCallId" TEXT,
    "error" TEXT,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiInsight_type_referenceType_referenceId_key" ON "AiInsight"("type", "referenceType", "referenceId");

-- AddForeignKey
ALTER TABLE "AiInsight" ADD CONSTRAINT "AiInsight_aiCallId_fkey" FOREIGN KEY ("aiCallId") REFERENCES "AiCall"("id") ON DELETE SET NULL ON UPDATE CASCADE;

