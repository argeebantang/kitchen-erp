-- Week 9 Task 3 (F3): the database login the assistant's run_query tool uses.
--
-- Claude writes the SQL, so what it may read is enforced here, by Postgres,
-- not by the prompt or by inspecting the SQL text:
--   - SELECT only, and only on the tables listed below. A table added by a
--     later migration is not readable until it is granted here on purpose.
--   - "User": only id, name, role, branchId, createdAt — never passwordHash
--     or email.
--   - Not granted: AiCall, AiInsight, Notification, _prisma_migrations.
--   - Every session is read-only and statements stop after 5 seconds (the
--     app also sets both on each query's transaction).
--
-- The role is created NOLOGIN with no password, so nothing secret is in git.
-- To switch it on, set a password once per database server (see
-- docs/2026-11-19-week9-nl-query.md) and put it in AI_DATABASE_URL in .env.
--
-- Roles belong to the whole database server, so IF NOT EXISTS keeps this
-- safe to run again (shadow databases, a second database on the same server).
-- Needs a migration user with CREATEROLE.
--
-- Not per row or per app role: a login with these grants can read every
-- branch's rows. The assistant is limited to ADMIN, ACCOUNTING and
-- PRODUCTION_MANAGER for that reason (noted for later: row-level security).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kitchen_ai_reader') THEN
    CREATE ROLE kitchen_ai_reader NOLOGIN;
  END IF;
END
$$;

ALTER ROLE kitchen_ai_reader SET default_transaction_read_only = on;
ALTER ROLE kitchen_ai_reader SET statement_timeout = '5s';
ALTER ROLE kitchen_ai_reader SET idle_in_transaction_session_timeout = '10s';

GRANT USAGE ON SCHEMA public TO kitchen_ai_reader;

GRANT SELECT ON
  "Branch",
  "Category",
  "Unit",
  "Material",
  "ItemPrice",
  "FinishedGood",
  "BOM",
  "BOMItem",
  "Supplier",
  "PurchaseRequest",
  "PurchaseRequestItem",
  "PurchaseOrder",
  "PurchaseOrderItem",
  "ReceivingReport",
  "ReceivingReportItem",
  "InventoryLevel",
  "StockMovement",
  "StockTransfer",
  "StockTransferItem",
  "FinishedGoodLot",
  "FinishedGoodLevel",
  "FinishedGoodMovement",
  "ProductionOrder",
  "ProductionStatusChange",
  "ConversionOrder",
  "WriteOff",
  "Approval"
TO kitchen_ai_reader;

GRANT SELECT ("id", "name", "role", "branchId", "createdAt") ON "User" TO kitchen_ai_reader;
