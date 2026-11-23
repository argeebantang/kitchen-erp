-- Week 11 Task 1: when a purchase request, purchase order or receiving report
-- was submitted for approval — the approvals inbox's "waiting since", and the
-- clock for the 24-hour escalation (Task 3). Nullable: drafts have none, and
-- documents decided before this column cannot be dated reliably.
ALTER TABLE "PurchaseRequest" ADD COLUMN "submittedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseOrder"   ADD COLUMN "submittedAt" TIMESTAMP(3);
ALTER TABLE "ReceivingReport" ADD COLUMN "submittedAt" TIMESTAMP(3);

-- Backfill only what is waiting now. Nothing can edit a pending document, so
-- its last update was the submit (requests and orders); a receiving report has
-- no updatedAt, so its creation is the best date there is.
UPDATE "PurchaseRequest" SET "submittedAt" = "updatedAt" WHERE status = 'PENDING_APPROVAL';
UPDATE "PurchaseOrder"   SET "submittedAt" = "updatedAt" WHERE status = 'PENDING_APPROVAL';
UPDATE "ReceivingReport" SET "submittedAt" = "createdAt" WHERE status = 'PENDING_APPROVAL';
