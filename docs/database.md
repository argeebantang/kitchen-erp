# Database

PostgreSQL 16, accessed exclusively through Prisma 5.22 (`prisma/schema.prisma`, client singleton at `lib/prisma.ts`). Only files under `repositories/` may import the Prisma client — see [architecture.md](architecture.md).

## General Principles

* Verify the schema before making assumptions — read `prisma/schema.prisma`, don't infer table shape from a UI mockup or an old memory of the project.
* Preserve existing production data. This is a financial/inventory system (purchase orders, stock levels, costs) — never write a change that silently drops or truncates data.
* Prefer additive changes over destructive changes: add a nullable column or a new table before renaming/dropping an existing one; deprecate in two steps (add new, migrate data, remove old) rather than one.
* IDs are `cuid()` strings everywhere (no auto-increment integers) — follow this for any new model.
* Money and quantity fields use Prisma `Decimal` (e.g. `unitCost`, `quantity`, `standardCost`), never `Float` — floating point is unacceptable for currency/inventory math. Do arithmetic with Decimal methods (`.add`, `.sub`, `.mul`, `.greaterThan`), not `Number(...)`.
* Date-only values (a delivery date, a needed-by date) are stored as UTC midnight (`new Date('YYYY-MM-DD')`) and displayed with `.slice(0, 10)`. "Today" for business rules is computed in Asia/Manila (`lib/dates.ts`).

## Migrations

Migrations are tracked in `prisma/migrations/`, baselined from the original `db push` schema as `0_init` (see `docs/2026-09-01-secret-hygiene-prisma-config-migration-baseline.md`). **Never run `prisma db push`** — it changes the schema with no migration and creates drift.

| Migration | What |
|---|---|
| `0_init` | Baseline of the Week 1 schema |
| `20260901101054_week2_item_prices_and_bom_batch` | `ItemPrice`, `BOM.batchSize`, BOM version uniqueness, first item-master indexes |
| `20260902113746_week3_procurement_workflow` | `ACCOUNTING` role, PO approval states, polymorphic `Approval`, `Notification`, `pr_number_seq` / `po_number_seq`, procurement indexes |
| `20261023055715_po_submitted_by` | `PurchaseOrder.submittedById` |
| `20261029065124_week4_receiving_report` | `RRStatus` reshaped; `branchId` + `receivedById` on `ReceivingReport`; `purchaseOrderItemId` on RR lines; `branchId` on `StockMovement`; `rr_number_seq`; RR and ledger indexes |
| `20261029220219_rr_expected_quantity` | `ReceivingReportItem.expectedQuantity` — hand-written add nullable → backfill → `NOT NULL` |
| `20261030034822_stock_movement_unit_cost` | `StockMovement.unitCost`, nullable |
| `20261030060104_stock_movement_reference_required` | `StockMovement.referenceType` / `referenceId` → `NOT NULL` |
| `20261108133119_production_status_change` | New `ProductionStatusChange` table (append-only status log) with `(productionOrderId, createdAt)` index |
| `20261108122903_production_order_submitted_by` | `ProductionOrder.submittedById` (nullable FK → `User`; no backfill — every row was a draft) |
| `20261107073325_week5_production_orders` | `ProductionStatus` replaced (`PLANNED` dropped, default `DRAFT`); `ProductionOrder.batchWeight` + `batchCount` (`NOT NULL`, table verified empty); `ProductionOrder(status)`, `(branchId)` indexes; `prd_number_seq` |

Workflow for a schema change:

1. Edit `schema.prisma`.
2. Generate the SQL: `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` into a new `prisma/migrations/<timestamp>_<name>/migration.sql` (or `prisma migrate dev --create-only` when the SQL needs hand edits).
3. **Read the SQL** before applying it.
4. `npx prisma migrate deploy`, then `npx prisma generate`.
5. Restart `npm run dev` **and** `npm run worker` — both hold the old generated client.

Things Prisma's schema language cannot express — standalone sequences, partial indexes — are hand-appended to the migration SQL with a comment. `migrate diff` ignores sequences, so they cause no drift.

## Relationships

The schema (25 models) groups into these domain areas — see [architecture.md](architecture.md#data-model) for the narrative version:

* **Identity**: `User.branchId → Branch` (optional — a user isn't necessarily tied to one branch, e.g. `ADMIN`/`PROCUREMENT_MANAGER`).
* **Item master**: `Material` and `FinishedGood` both reference `Category` and `Unit`. `Category.type` is a free-text field (`'RAW_MATERIAL' | 'FINISHED_GOOD' | 'PACKAGING'`, listed as `CATEGORY_TYPES` in `category.repository.ts`) rather than an enum. `ItemPrice` holds dated reference prices per material, optionally per supplier; the effective price is the newest row on or before the date asked.
* **BOM**: `FinishedGood → BOM (1:N, versioned via BOM.version + isActive, unique per finished good + version) → BOMItem (1:N) → Material`. Quantities are per batch of `batchSize`. Old versions are kept (`isActive = false`), never deleted — supersede, don't hard-delete.
* **Procurement chain**: `PurchaseRequest (1:N) → PurchaseOrder (purchaseRequestId nullable) (1:N) → ReceivingReport`. Each stage has its own line table and status enum; transitions are enforced in the service layer, not by the database.
  * `PRStatus`: `DRAFT → PENDING_APPROVAL → CONVERTED_TO_PO | REJECTED`. Approval generates the draft order in the same transaction, so a request goes straight to `CONVERTED_TO_PO`; `APPROVED` exists in the enum but is never left standing.
  * `POStatus`: `DRAFT → PENDING_APPROVAL → APPROVED | REJECTED`, then `SENT → PARTIALLY_RECEIVED → FULLY_RECEIVED`, set by RR approval from the cumulative accepted quantity per line (all lines full → fully; some → partially; none, e.g. an all-rejected delivery → stays `SENT`); `CANCELLED` exists but is not yet used. `supplierId` is null on a freshly generated draft; `submittedById` records who submitted it.
  * `RRStatus`: `DRAFT → PENDING_APPROVAL → APPROVED | REJECTED`. `ReceivingReport.branchId` is where the delivery arrived; `receivedById` is who counted it (whoever last saved it). Each `ReceivingReportItem` links to its `PurchaseOrderItem`; `orderedQuantity` and `unitCost` are copied from the PO line. `expectedQuantity` is what was outstanding on the PO line when the line was saved — variance (short / over-delivered / rejected) is measured against it and derived, never stored. Stock in = `receivedQuantity − rejectedQuantity`. Outstanding per PO line = ordered − accepted across **approved** RRs only.
  * `REJECTED` is terminal for all three.
* **Inventory**: `InventoryLevel` is current-state (one row per `materialId` + `branchId`, `@@unique`). `StockMovement` is an append-only ledger, also per material + branch. Every row names its source document via `referenceType`/`referenceId` — both `NOT NULL`, but polymorphic, so not a real FK: the database guarantees a reference exists, not that it points at a valid row. **`quantity` is signed** — positive into stock, negative out of it — so a balance is `SUM(quantity)`, and for each (material, branch) the ledger's sum must equal `InventoryLevel.quantity` (the Stock Ledger page checks this). Direction cannot come from `MovementType` alone: a `TRANSFER` is out at one branch and in at another. Any code that writes inventory must update `InventoryLevel.quantity` and insert a `StockMovement` row **in the same transaction**, never one without the other — use `InventoryRepository.stockIn(tx, …)`, which does both on the caller's transaction, rather than writing either table directly. The level change is an upsert on the unique key with `increment`, which Prisma issues as one `INSERT … ON CONFLICT DO UPDATE` (atomic, no lost updates). `StockMovement.unitCost` is the purchase cost per unit on a receiving `IN`; null where no cost rule exists yet (costing method: Week 6). `InventoryLevel.updatedAt` is therefore the time of the last movement for that material at that branch, and the stock map reads it as such instead of scanning the ledger — so never update a level row except together with a movement. Today the only writer is RR approval: one `IN` per line with accepted > 0, `referenceType 'ReceivingReport'`, `referenceId` = the RR.
* **Production**: `ProductionOrder` pins `finishedGoodId` + `bomId` + `branchId` + `requestedById` together, so a production run always records exactly which BOM version was used.
  * `ProductionStatus`: `DRAFT → PENDING_APPROVAL → APPROVED | REJECTED → IN_PROGRESS → COMPLETED`, plus `CANCELLED`. Built so far: create / edit drafts (Task 1), submit `DRAFT → PENDING_APPROVAL` and the decision `→ APPROVED | REJECTED` (Task 5), start `APPROVED → IN_PROGRESS` and cancel `DRAFT | PENDING_APPROVAL | APPROVED → CANCELLED` (Task 6); complete is Week 6. `REJECTED` and `CANCELLED` are terminal; an in-progress run cannot be cancelled (its ingredients are being used — a write-off, Week 7). `submittedById` records who submitted (null until then); whoever submitted cannot decide it.
  * `batchWeight` (output of one batch, in the BOM's batch unit — the service refuses a BOM whose batch unit differs from the finished good's unit) × `batchCount` (whole number, 1–100) = `plannedQty`, computed in Decimal and stored because Week 6 compares `actualQty` with it. `plannedDate` is a date-only value (UTC midnight).
  * `bomId` is the finished good's **active** version, re-pinned on every save of a draft; the pin becomes permanent at submission. `requestedById` is the creator and does not change when someone else edits the draft.
  * Material requirements are **not stored**: they are the pinned BOM's lines scaled to `batchWeight` (per batch) and `plannedQty` (total), recomputed on read. The pinned version never changes, so a stored copy could only drift from it. What a run actually consumed is a separate record (Week 6).
  * The stock check is derived too: `InventoryLevel` at the order's branch, minus the requirements of other `APPROVED` / `IN_PROGRESS` orders there (`COMMITTING_STATUSES` in `production-order.repository.ts`) — stock only leaves on completion, so those are still on the shelf but spoken for. Nothing is reserved in the database. A line's shortage is `max(required − max(available, 0), 0)`: never more than the run's own requirement, so when other orders have over-committed the stock, each order reports only its own need (fixed 2026-11-08; before, two approved runs each counted the other's demand).
* **Distribution**: `StockTransfer` has two named relations to `Branch` (`TransferFrom`/`TransferTo`) — when querying, be explicit about which side you mean.
* **Conversions**: `Conversion` has two named relations to `FinishedGood` (`ConversionSource`/`ConversionOutput`). It has no cost, status or approver columns yet (Week 7).
* **Production status log**: `ProductionStatusChange` — one row per status change of a `ProductionOrder` (`fromStatus`, `toStatus`, `changedById → User`, `note` = approval remarks or cancel reason, `createdAt`), append-only, written by `transition()` in `production-order.repository.ts` **in the same transaction** as the status update and only when the update matched a row, so the log cannot disagree with the status. Creation is not logged (the order row has `createdAt` / `requestedById`); edits are not logged. It drives the order page's timeline. Approval decisions are logged here *and* in `Approval` (which the other workflows use).
* **Approvals**: `Approval` is polymorphic — `referenceType` (`'PurchaseRequest' | 'PurchaseOrder' | 'ReceivingReport' | 'ProductionOrder'`) + `referenceId`, one row per decision, with the approver, `decision`, `remarks`, `decidedAt`. The document's own status column says where it is now; `Approval` says who decided and why.
* **Notifications**: `Notification.userId → User`, with an optional polymorphic reference to the document; unread while `readAt` is null. `type` says what happened: `PR_SUBMITTED` (reference = the purchase request); `PRODUCTION_ORDER_SUBMITTED`, `PRODUCTION_ORDER_APPROVED`, `PRODUCTION_ORDER_REJECTED` (reference = the production order); `PRODUCTION_SHORTFALL` (`referenceType` `ProductionOrderShortfall`, `referenceId` = the order — its link is the pre-filled purchase request); `LOW_STOCK` and `STOCK_MISMATCH` from the daily jobs. The daily ones reference no document: `referenceType` is `LowStockCheck` / `StockReconciliation` and `referenceId` the Manila date (YYYY-MM-DD), which is also what stops a second notification the same day. `readAt` is set by `POST /api/notifications/read` (only the user's own, only while null); the bell counts `readAt IS NULL` through `@@index([userId, readAt])`.

## Document numbers

`prNumber`, `poNumber`, `rrNumber` and `ProductionOrder.orderNumber` (`PRD-000001`) come from Postgres sequences — `pr_number_seq`, `po_number_seq`, `rr_number_seq`, `prd_number_seq` — read with ``tx.$queryRaw`SELECT nextval('…')` `` inside the creating transaction and formatted `XX-000001` in the app. Sequences are gap-tolerant (a rolled-back transaction burns a number); uniqueness matters, contiguity does not. Never use `count() + 1`.

## Indexing

Postgres does not auto-index foreign keys, so every join or filter column needs an explicit `@@index`. Current indexes beyond the `@unique` keys:

* `Material(categoryId)`; `ItemPrice(materialId, effectiveDate)` and `(materialId, supplierId, effectiveDate)`
* `BOM(finishedGoodId, isActive)`, `@@unique(finishedGoodId, version)`; `BOMItem(bomId)`
* `PurchaseRequest(status)`, `(requestedById)`; `PurchaseRequestItem(purchaseRequestId)`
* `PurchaseOrder(status)`, `(supplierId)`, `(purchaseRequestId)`; `PurchaseOrderItem(purchaseOrderId)`
* `ReceivingReport(purchaseOrderId)`, `(status)`, `(branchId)`; `ReceivingReportItem(receivingReportId)`, `(purchaseOrderItemId)`
* `InventoryLevel @@unique(materialId, branchId)`
* `StockMovement(materialId, branchId, createdAt)` for per-item ledger history, `(referenceType, referenceId)` for a document's movements
* `ProductionOrder(status)`, `(branchId)`
* `Approval(referenceType, referenceId)`; `Notification(userId, readAt)`

Not yet indexed, add with the feature that queries them: `StockTransfer` from/to branch; `ProductionOrder(plannedDate)` with the schedule calendar.

## Large Data

* Paginate any list over a table that grows unboundedly. Repository list methods take `skip`/`take` (default `take: 50`) and return rows plus a count from one `$transaction` (`MaterialRepository`, `PurchaseOrderRepository`, `ReceivingReportRepository`).
* Batch bulk writes — `createMany`, nested `create` on a parent, or one `$transaction` — instead of one query per row.
* Use background jobs (BullMQ, see [architecture.md](architecture.md#infrastructure)) for anything that scans many rows or calls an external service: low-stock checks, escalations, report generation.
* Aggregate in the database (`aggregate`/`groupBy`) rather than pulling rows into Node — e.g. accepted quantity per PO line is one `groupBy` over approved RR lines, and variance lines per report one `groupBy` per list page. To compare two columns of the same row in a filter, use a Prisma field reference (`prisma.receivingReportItem.fields.expectedQuantity`).

## Multi-Tenant

This is not a multi-tenant system in the SaaS sense (no per-customer data isolation) — it's a single organization with multiple **branches**. Branch is a data-partitioning dimension, not a security boundary enforced at the database level:

* `InventoryLevel`, `StockMovement`, `ReceivingReport`, `StockTransfer` (from/to), and `ProductionOrder` are branch-scoped via `branchId`.
* There is no row-level security or Prisma middleware restricting queries by branch — data access is gated by `middleware.ts` role guards and service rules, not by filtering results to the user's own `branchId`.
* If branch-level isolation becomes a requirement (a branch manager sees only their branch's inventory), add that filter explicitly in the service/repository layer — a route guard alone does not stop a broad query.

## Migration Checklist

Before creating a migration:

* **Backward compatibility** — will existing running code (or a mid-deploy old instance) still work against the new schema? Prefer nullable-then-backfill-then-required over adding a `NOT NULL` column directly to a table with existing rows. (The Week 3 and Week 4 migrations added `NOT NULL` columns directly only because the tables were verified empty first.)
* **Existing data impact** — check row counts and current values for any column being altered/dropped; a `Decimal` or enum change can silently truncate or fail on real data (e.g. removing an enum value breaks rows that use it).
* **Rollback strategy** — Prisma migrations are forward-only; know how you'd write the down-migration or restore from backup before running an irreversible change against real data.
* **Performance impact** — adding an index or `NOT NULL` constraint to a large table (`StockMovement` once populated) can lock it during the migration; check whether it needs to run outside peak hours or use a concurrent index build.
