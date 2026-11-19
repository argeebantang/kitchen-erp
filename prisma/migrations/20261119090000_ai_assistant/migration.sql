-- Week 9 Task 3: AiFeature gains ASSISTANT — the dashboard assistant (Feature 2),
-- one AiCall per round of a question. Not used in this migration, so ADD VALUE
-- inside its transaction is safe. Additive only.

-- AlterEnum
ALTER TYPE "AiFeature" ADD VALUE 'ASSISTANT';

