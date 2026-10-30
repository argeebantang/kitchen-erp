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

Workflow for a schema change:

1. Edit `schema.prisma`.
2. Generate the SQL: `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` into a new `prisma/migrations/<timestamp>_<name>/migration.sql` (or `prisma migrate dev --create-only` when the SQL needs hand edits).
3. **Read the SQL** before applying it.
4. `npx prisma migrate deploy`, then `npx prisma generate`.
5. Restart `npm run dev` **and** `npm run worker` — both hold the old generated client.

Things Prisma's schema language cannot express — standalone sequences, partial indexes — are hand-appended to the migration SQL with a comment. `migrate diff` ignores sequences, so they cause no drift.

## Relationships

The schema (24 models) groups into these domain areas — see [architecture.md](architecture.md#data-model) for the narrative version:

* **Identity**: `User.branchId → Branch` (optional — a user isn't necessarily tied to one branch, e.g. `ADMIN`/`PROCUREMENT_MANAGER`).
* **Item master**: `Material` and `FinishedGood` both reference `Category` and `Unit`. `Category.type` is a free-text field (`'RAW_MATERIAL' | 'FINISHED_GOOD' | 'PACKAGING'`, listed as `CATEGORY_TYPES` in `category.repository.ts`) rather than an enum. `ItemPrice` holds dated reference prices per material, optionally per supplier; the effective price is the newest row on or before the date asked.
* **BOM**: `FinishedGood → BOM (1:N, versioned via BOM.version + isActive, unique per finished good + version) → BOMItem (1:N) → Material`. Quantities are per batch of `batchSize`. Old versions are kept (`isActive = false`), never deleted — supersede, don't hard-delete.
* **Procurement chain**: `PurchaseRequest (1:N) → PurchaseOrder (purchaseRequestId nullable) (1:N) → ReceivingReport`. Each stage has its own line table and status enum; transitions are enforced in the service layer, not by the database.
  * `PRStatus`: `DRAFT → PENDING_APPROVAL → CONVERTED_TO_PO | REJECTED`. Approval generates the draft order in the same transaction, so a request goes straight to `CONVERTED_TO_PO`; `APPROVED` exists in the enum but is never left standing.
  * `POStatus`: `DRAFT → PENDING_APPROVAL → APPROVED | REJECTED`, then `SENT → PARTIALLY_RECEIVED → FULLY_RECEIVED`; `CANCELLED` exists but is not yet used. `supplierId` is null on a freshly generated draft; `submittedById` records who submitted it.
  * `RRStatus`: `DRAFT → PENDING_APPROVAL → APPROVED | REJECTED`. `ReceivingReport.branchId` is where the delivery arrived; `receivedById` is who counted it (whoever last saved it). Each `ReceivingReportItem` links to its `PurchaseOrderItem`; `orderedQuantity` and `unitCost` are copied from the PO line. `expectedQuantity` is what was outstanding on the PO line when the line was saved — variance (short / over-delivered / rejected) is measured against it and derived, never stored. Stock in = `receivedQuantity − rejectedQuantity`. Outstanding per PO line = ordered − accepted across **approved** RRs only.
  * `REJECTED` is terminal for all three.
* **Inventory**: `InventoryLevel` is current-state (one row per `materialId` + `branchId`, `@@unique`). `StockMovement` is an append-only ledger, also per material + branch, keyed loosely to its source document via `referenceType`/`referenceId` (polymorphic, not a real FK — no DB-level guarantee it points at a valid row). Any code that writes inventory must update `InventoryLevel.quantity` and insert a `StockMovement` row **in the same transaction**, never one without the other. (No code writes stock yet; the first is RR approval, Week 4 task 4.)
* **Production**: `ProductionOrder` pins `finishedGoodId` + `bomId` + `branchId` + `requestedById` together, so a production run always records exactly which BOM version was used.
* **Distribution**: `StockTransfer` has two named relations to `Branch` (`TransferFrom`/`TransferTo`) — when querying, be explicit about which side you mean.
* **Conversions**: `Conversion` has two named relations to `FinishedGood` (`ConversionSource`/`ConversionOutput`). It has no cost, status or approver columns yet (Week 7).
* **Approvals**: `Approval` is polymorphic — `referenceType` (`'PurchaseRequest' | 'PurchaseOrder' | 'ReceivingReport'`) + `referenceId`, one row per decision, with the approver, `decision`, `remarks`, `decidedAt`. The document's own status column says where it is now; `Approval` says who decided and why.
* **Notifications**: `Notification.userId → User`, with an optional polymorphic reference to the document; unread while `readAt` is null.

## Document numbers

`prNumber`, `poNumber` and `rrNumber` come from Postgres sequences — `pr_number_seq`, `po_number_seq`, `rr_number_seq` — read with ``tx.$queryRaw`SELECT nextval('…')` `` inside the creating transaction and formatted `XX-000001` in the app. Sequences are gap-tolerant (a rolled-back transaction burns a number); uniqueness matters, contiguity does not. Never use `count() + 1`.

## Indexing

Postgres does not auto-index foreign keys, so every join or filter column needs an explicit `@@index`. Current indexes beyond the `@unique` keys:

* `Material(categoryId)`; `ItemPrice(materialId, effectiveDate)` and `(materialId, supplierId, effectiveDate)`
* `BOM(finishedGoodId, isActive)`, `@@unique(finishedGoodId, version)`; `BOMItem(bomId)`
* `PurchaseRequest(status)`, `(requestedById)`; `PurchaseRequestItem(purchaseRequestId)`
* `PurchaseOrder(status)`, `(supplierId)`, `(purchaseRequestId)`; `PurchaseOrderItem(purchaseOrderId)`
* `ReceivingReport(purchaseOrderId)`, `(status)`, `(branchId)`; `ReceivingReportItem(receivingReportId)`, `(purchaseOrderItemId)`
* `InventoryLevel @@unique(materialId, branchId)`
* `StockMovement(materialId, branchId, createdAt)` for per-item ledger history, `(referenceType, referenceId)` for a document's movements
* `Approval(referenceType, referenceId)`; `Notification(userId, readAt)`

Not yet indexed, add with the feature that queries them: `ProductionOrder(status)`, `(branchId)`; `StockTransfer` from/to branch.

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
