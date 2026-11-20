-- Week 9 Task 5: the assistant's write actions, on the query log (the plan's
-- ai_query_log gains action type, confirmed / cancelled and the created document).
-- AiQuery: the draft Claude proposed (actionType, actionDraft, actionProposedAt),
-- what the user decided (actionStatus, actionDecidedAt) and what Confirm created
-- (actionDocumentId, actionDocumentNumber). Additive only: two enums and nullable
-- columns; existing questions keep them null.

-- CreateEnum
CREATE TYPE "AiActionType" AS ENUM ('PURCHASE_REQUEST', 'PRODUCTION_ORDER');

-- CreateEnum
CREATE TYPE "AiActionStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'CANCELLED');

-- AlterTable
ALTER TABLE "AiQuery" ADD COLUMN     "actionDecidedAt" TIMESTAMP(3),
ADD COLUMN     "actionDocumentId" TEXT,
ADD COLUMN     "actionDocumentNumber" TEXT,
ADD COLUMN     "actionDraft" JSONB,
ADD COLUMN     "actionProposedAt" TIMESTAMP(3),
ADD COLUMN     "actionStatus" "AiActionStatus",
ADD COLUMN     "actionType" "AiActionType";

