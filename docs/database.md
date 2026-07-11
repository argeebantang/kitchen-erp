# Database

PostgreSQL 16, accessed exclusively through Prisma (`prisma/schema.prisma`, client singleton at `lib/prisma.ts`). Only files under `repositories/` may import the Prisma client — see [architecture.md](architecture.md).

## General Principles

* Verify the schema before making assumptions — read `prisma/schema.prisma`, don't infer table shape from a UI mockup or an old memory of the project.
* Preserve existing production data. This is a financial/inventory system (purchase orders, stock levels, costs) — never write a change that silently drops or truncates data.
* Prefer additive changes over destructive changes: add a nullable column or a new table before renaming/dropping an existing one; deprecate in two steps (add new, migrate data, remove old) rather than one.
* Use migrations whenever possible.
  * **Current state**: there is no `prisma/migrations/` directory in this repo yet — the schema has only been applied via `prisma db push`, so there's no tracked migration history. `prisma db push` is fine for local iteration, but any change bound for a shared/production database should switch to `prisma migrate dev` (which generates a reviewable SQL migration file) rather than continuing to push schema drift with no history. Establishing real migrations before the first deploy is worth doing proactively.
* IDs are `cuid()` strings everywhere (no auto-increment integers) — follow this for any new model.
* Money and quantity fields use Prisma `Decimal` (e.g. `unitCost`, `quantity`, `standardCost`), never `Float` — floating point is unacceptable for currency/inventory math. Keep this for any new numeric field that represents cost or quantity.

## Relationships

The schema (22 models) groups into these domain areas — see [architecture.md](architecture.md#data-model) for the narrative version:

* **Identity**: `User.branchId → Branch` (optional — a user isn't necessarily tied to one branch, e.g. `ADMIN`/`PROCUREMENT_MANAGER`).
* **Item master**: `Material` and `FinishedGood` both reference `Category` and `Unit`. `Category.type` is a free-text field (`'RAW_MATERIAL' | 'FINISHED_GOOD' | 'PACKAGING'`) rather than an enum — treat those three strings as the fixed set until it's formalized.
* **BOM**: `FinishedGood → BOM (1:N, versioned via BOM.version + isActive) → BOMItem (1:N) → Material`. Old BOM versions are kept (`isActive = false`), not deleted — never hard-delete a `BOM` row; supersede it.
* **Procurement chain**: `PurchaseRequest (1:N) → PurchaseOrder (optional link back via purchaseRequestId) (1:N) → ReceivingReport`. A single PR can produce multiple POs; a PO's `purchaseRequestId` is nullable (POs can be created without a PR). Each stage has its own item line table (`PurchaseRequestItem`, `PurchaseOrderItem`, `ReceivingReportItem`) and its own status enum (`PRStatus`, `POStatus`, `RRStatus`) — status transitions are enforced in the service layer, not by the database.
* **Inventory**: `InventoryLevel` is current-state (one row per `materialId` + `branchId`, enforced by `@@unique([materialId, branchId])`); `StockMovement` is an append-only ledger keyed loosely to its source document via `referenceId`/`referenceType` (polymorphic reference, not a real FK — there's no DB-level guarantee it points at a valid row). Any code that writes inventory changes must keep these two in sync in the same transaction: update `InventoryLevel.quantity` and insert a `StockMovement` row together, never one without the other.
* **Production**: `ProductionOrder` pins `finishedGoodId` + `bomId` + `branchId` + `requestedById` together, so a production run always records exactly which BOM version was used.
* **Distribution**: `StockTransfer` has two named relations to `Branch` (`TransferFrom`/`TransferTo`) — when querying, be explicit about which side you mean.
* **Conversions**: `Conversion` similarly has two named relations to `FinishedGood` (`ConversionSource`/`ConversionOutput`).
* **Approvals**: `Approval` currently links only to `PurchaseRequest` — there is no generic/polymorphic approval table covering `PurchaseOrder`, `ReceivingReport`, `ProductionOrder`, or `Conversion` yet, even though those all have status enums that imply an approval step. If those workflows need tracked approvals, decide whether to extend `Approval` to be polymorphic (`referenceId`/`referenceType`, matching the `StockMovement` pattern) or add per-entity approval tables — don't assume `Approval` already covers them.

## Indexing

Today the schema has exactly one explicit index: `InventoryLevel.@@unique([materialId, branchId])`. Every other foreign key (`Material.categoryId`, `PurchaseOrderItem.purchaseOrderId`, `StockMovement.materialId`, etc.) has **no** `@@index`. Unlike MySQL, Prisma does not auto-index foreign key columns on PostgreSQL — so joins and filtered lookups on any of those columns currently do a sequential scan. Before adding query-heavy features (dashboards, reports, lookups by branch/material/status), add indexes for:

* Frequently filtered columns — especially status enums used in "pending approval" style inbox queries (`PurchaseRequest.status`, `PurchaseOrder.status`, `ProductionOrder.status`).
* Join/foreign-key columns used in lookups — e.g. `StockMovement.materialId`, `PurchaseOrderItem.purchaseOrderId`, `ProductionOrder.branchId`.
* Natural lookup keys already marked `@unique` (`Material.code`, `PurchaseRequest.prNumber`, etc.) are already indexed by the unique constraint — no action needed there.
* Composite indexes where queries always filter on the same pair, mirroring the existing `InventoryLevel` pattern (e.g. a future `StockMovement.@@index([materialId, createdAt])` for per-item ledger history queries).

## Large Data

* Use pagination for any list endpoint over a table that grows unboundedly — `StockMovement`, `Approval`, and the procurement/production tables will all accumulate indefinitely. None of the current repositories implement pagination yet (only single-record lookups exist in `UserRepository`); add `skip`/`take` (or cursor pagination) when building the first list query rather than fetching whole tables.
* Use chunking for bulk writes (e.g. seeding or importing large BOMs/materials) via `createMany` or batched `$transaction` calls instead of one query per row.
* Use background jobs (BullMQ is already a dependency, not yet wired to a queue — see [architecture.md](architecture.md#infrastructure)) for expensive operations: low-stock checks, report generation, PDF export, anything that scans many rows or calls an external API.
* Avoid loading entire tables into memory — this matters especially for `StockMovement` and any future costing/reporting queries that touch full production history; aggregate in the database (Prisma `aggregate`/`groupBy`) rather than pulling rows into Node to sum/average.

## Multi-Tenant

This is not a multi-tenant system in the SaaS sense (no per-customer data isolation) — it's a single organization with multiple **branches**. Branch is a data-partitioning dimension, not a security boundary enforced at the database level:

* `InventoryLevel`, `StockTransfer` (from/to), and `ProductionOrder` are branch-scoped via `branchId`.
* There is no row-level security or Prisma middleware restricting queries by branch — a `BRANCH_MANAGER`'s data access is currently gated only by `middleware.ts` role guards on routes (e.g. `/dashboard/branches`), not by filtering query results to the user's own `branchId`.
* If branch-level data isolation becomes a real requirement (a branch manager should only ever see their own branch's inventory/production), that filter needs to be added explicitly in the service/repository layer — don't assume the route guard alone prevents a `BRANCH_MANAGER` from reading another branch's data if a handler queries broadly.

## Migration Checklist

Before creating a migration:

* **Backward compatibility** — will existing running code (or a mid-deploy old instance) still work against the new schema? Prefer nullable-then-backfill-then-required over adding a `NOT NULL` column directly to a table with existing rows.
* **Existing data impact** — check row counts and current values for any column being altered/dropped; a `Decimal` or enum change can silently truncate or fail on real data (e.g. narrowing `MovementType` or `PRStatus` would break existing rows using a removed value).
* **Rollback strategy** — Prisma migrations are forward-only by default; know how you'd write the down-migration or restore-from-backup before running an irreversible change (dropping a column, renaming a table) against real data.
* **Performance impact** — adding an index or `NOT NULL` constraint to a large existing table (`StockMovement` once populated) can lock it during the migration; check whether it needs to run outside peak hours or use a concurrent index build.
