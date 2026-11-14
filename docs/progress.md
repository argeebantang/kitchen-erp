# Project Progress

Tracks delivery against the 12-week sprint plan (`kitchenERP-sprint-v3.jsx`). Update this
file — and check off tasks — as part of the same commit that completes them.

Legend: `[x]` done · `[~]` partial (see note) · `[ ]` not started

---

## Pending schema work

**Corrected 2026-08-17.** The Week 1 entry previously claimed the 22-table schema covered
costing and AI. It does not. All 22 models in `prisma/schema.prisma` are core domain tables
(users, branches, items, BOM, procurement, inventory, production, approvals). The costing and AI
tables listed on the sprint plan's DB Schema tab are **additions still to be made**, not part of
the 22. Final count will be 26 tables.

**Update (2026-09-03):** Week 3 added a 23rd core table, `Notification` — not on the sprint
plan's list, but required as the sink for the BullMQ jobs (PR submitted, low stock, escalation)
and as the foundation for Week 11's notification bell + email. Final count is therefore 27.

| Needed | Status in `schema.prisma` | Due |
|---|---|---|
| `item_prices` | **Done (2026-09-01).** `ItemPrice` added — open-ended effective dating with an optional `supplierId` (null = organisation reference price). `Material.standardCost` is deprecated but retained; nothing reads it. | Week 2 |
| Production costing fields | **Done (2026-11-09).** `ProductionOrder.plannedCost`, `actualCost`, `costPerUnit`, `costVariance` as columns (one approval per order, so no separate `production_actuals` table); see `docs/2026-11-09-week6-production-costing.md`. | Week 6 |
| Conversion costing + approval | **Done (2026-11-12).** `ConversionOrder` replaces the unused `Conversion` stub: status, submitter, `sourceCost` / `conversionCost` / `costPerUnit` recorded at approval (the approver is on `Approval`); see `docs/2026-11-12-week7-conversion-orders.md`. | Week 7 |
| `writeoffs` | **Done (2026-11-12).** `WriteOff` — one finished-goods lot at one branch, quantity, reason (`WriteOffReason`), status, `unitCost` / `totalCost` recorded at approval (the approver is on `Approval`); see `docs/2026-11-12-week7-write-offs.md`. | Week 7 |
| `ai_insights` | **Missing.** Required by Features 1, 3, 4, 6. | Week 9 |
| `ai_query_log` | **Missing.** Required by Feature 2 and its write-action audit trail. | Week 9 |

Two consequences worth planning around:

1. **Costing is not free at Week 6.** ✅ Resolved for Week 2 — `ItemPrice` shipped on schedule, so
   Weeks 6–8 costing and Feature 1 (Cost Variance Explainer) are unblocked. The remaining rows
   above still apply at their own due dates.
2. **Migrations are now established.** ✅ Resolved 2026-09-01. `prisma/migrations/` exists,
   baselined at `0_init` from the pre-existing `db push` schema, with
   `20260901101054_week2_item_prices_and_bom_batch` as the first real migration. **Do not use
   `prisma db push` on this project any more** — every schema change goes through
   `npx prisma migrate dev --name <change>`.

---

## Phase 1 — Foundation & Procurement (Weeks 1–4)

### Week 1 — Project Setup & Database Schema
- [x] Initialize Next.js 15 + TypeScript monorepo
- [~] Prisma schema: 22 tables covering the core domain — **not** costing or AI (see Pending schema work below)
- [x] Docker Compose: PostgreSQL + Redis
- [x] GitHub repo + GitHub Actions CI pipeline — typecheck, lint, `prisma validate` and
      `npm run build`. The build step was added 2026-09-18; before that CI never exercised a
      production build, which is how two production-only bugs reached main (see Week 2 note).
- [~] Auth with 5 roles — implemented as `ADMIN, PROCUREMENT_MANAGER, PRODUCTION_MANAGER, BRANCH_MANAGER, VIEWER` (renamed from the plan's Admin/Accounting Approver/Warehouse Staff/Kitchen Supervisor/Branch Manager — intentional naming, matches `docs/overview.md`)
- [x] Login page + protected route middleware per role
- [x] Logout (topbar button, `components/dashboard/Topbar.tsx`)
- [x] Seed script (`prisma/seed.ts`)

**Deliverable status:** met — login, logout, role-based middleware, and the 22-table core schema are in place.

**Note (2026-07-11):** `middleware.ts` `ROLE_GUARDS` still referenced the pre-flattening
dashboard URLs (`/dashboard/procurement` etc.) after the routes moved to `/procurement/*`,
`/production/*`, etc. — the guards were silently dead, so a VIEWER typing a restricted URL
directly wasn't blocked at the middleware level (only hidden from the sidebar). Fixed to guard
the current flat paths; added `app/unauthorized/page.tsx` since the redirect target didn't
exist yet either.

**Note:** the original plan called for a separate Fastify API server; this was intentionally
dropped in favor of Next.js API routes only (see `docs/overview.md`).

### Week 2 — Item Master & Bill of Materials
- [x] Item Master CRUD (name, category, unit, reorder point) — `/admin/master`, four tabs
      (Materials, Finished Goods, Categories, Units). Finished goods, categories and units were
      in scope by necessity: a BOM can't reference anything without them.
- [x] Unit price per item with `effective_date` — `ItemPrice`, open-ended (no `endDate`), with
      optional `supplierId` and supplier→reference fallback on lookup
- [x] BOM module: finished goods with ingredient lines per batch weight — required adding
      `BOM.batchSize` + `batchUnitId`; without a denominator the lines couldn't be scaled
- [x] BOM scaled viewer (batch weight → auto-calculated quantities) — scaling runs server-side in
      `Decimal` via `?qty=`, reusable by Week 5 for production material requirements
- [x] BOM version history — every edit creates a new version; `@@unique([finishedGoodId, version])`
- [x] Seed real BOMs (Dinuguan 10kg/11 lines, Lechon Paksiw 10kg/9 lines, Bopis 8kg/14 lines)

**Deliverable status:** met. See `docs/2026-09-01-week2-item-master-and-bom.md`.

**Note (2026-09-01):** two pre-existing bugs were found and fixed while verifying this work, both
unrelated to Week 2 and both invisible in `next dev`:
1. `middleware.ts` imported `verifyToken` from `lib/auth.ts`, which also imports **bcryptjs** —
   forbidden in the Edge runtime. Every protected route 500'd under `next build && next start`.
   Split into `lib/jwt.ts` (Edge-safe) and `lib/auth.ts` (Node-only).
2. `eslint.config.mjs` had never worked — it was generated for `eslint-config-next` 15.5+ but the
   project pins 15.3.4, so `npm run lint` errored out in CI. Replaced with the `FlatCompat` bridge.

### Week 3 — Purchase Request & Purchase Order
- [x] Schema foundation — `ACCOUNTING` role, polymorphic `Approval`, `Notification` table,
      `POStatus` approval states, nullable `PurchaseOrder.supplierId`, inbox/FK indexes, and
      `pr_number_seq`/`po_number_seq` for race-free document numbers. Middleware `/procurement`
      guard split so accounting approves and procurement cannot.
      Migration `20260902113746_week3_procurement_workflow`.
- [x] PR form + status flow (Draft → Pending → Approved/Rejected) — list, form with live cost
      estimate, detail page, and the full lifecycle. Lines are auto-priced from `ItemPrice`
      when no cost is typed; `prNumber` comes from `pr_number_seq`. Requesters see only their
      own requests; accounting, procurement and admin see all. Each transition has its own
      endpoint so `middleware.ts` can authorise by path: `POST /api/purchase-requests/[id]/submit`
      (requester or ADMIN) and `POST /api/approvals` (accounting only). Nobody approves their
      own request, ADMIN included.
- [x] Accounting approver inbox — `/procurement/approvals`, guarded to ADMIN + ACCOUNTING,
      ordered by soonest `neededBy` (undated requests sort last). The decision is made on the
      detail page so the approver sees the lines before deciding; approve/reject writes an
      `Approval` row and flips the PR status in one transaction, and the detail page then shows
      who decided, when, and their remarks.
- [x] BullMQ notification job on PR submission — `lib/queue.ts` (producer) enqueues on submit;
      `worker/index.ts` runs as a **separate process** (`npm run worker`) and writes
      `Notification` rows via `NotificationService`. Approvers are notified, minus whoever
      raised the request. A Redis outage never fails the submit.
- [x] Auto-generate PO draft on PR approval — approving writes the `Approval` row, creates a
      `DRAFT` PurchaseOrder with its lines, and moves the request to `CONVERTED_TO_PO`, all in
      one transaction. `supplierId` is left null: a request never names a supplier, and
      choosing one is procurement's job. Lines carry the cost the approver actually saw.
- [x] PO form + approval — `/procurement/orders` list and detail, with a sourcing form on
      drafts (supplier, expected delivery, notes; saving re-prices every line against the
      chosen supplier). Procurement submits a sourced draft (`POST
      /api/purchase-orders/[id]/submit`, refused while `supplierId` is null), accounting
      approves or rejects through the same `POST /api/approvals` the requests use, and
      procurement marks an approved order sent. The submitter is recorded
      (`PurchaseOrder.submittedById`, migration `20261023055715_po_submitted_by`) so nobody
      approves their own submission, ADMIN included. Decisions are race-guarded in the UPDATE,
      and show on the order with who decided and why. The approvals inbox lists pending
      orders under pending requests.
- [x] PO PDF export — via `@react-pdf/renderer`, not Puppeteer (no Chromium binary; see
      change note). `GET /api/purchase-orders/[id]/pdf` renders an A4 document (header,
      supplier, line table, total, notes, approver and date, page numbers) for `APPROVED`
      and `SENT` orders only; any other status gets a 409. A "Download PDF" button on the
      order page opens it in a new tab. Rendered inline in the request — no queue.

**Note (2026-09-03):** four schema blockers found while planning Week 3 are now resolved —
there was no `ACCOUNTING` role, `POStatus` had no approval states, `Approval` was PR-only, and
`prNumber`/`poNumber` had no race-free generator. See `docs/2026-09-03-week3-procurement.md`
for the decisions and their rationale.

### Week 4 — Receiving Report & Stock Update
- [x] RR form linked to approved PO — `/procurement/receiving/new?po=<id>`, opened from
      **Receive delivery** on a `SENT` or `PARTIALLY_RECEIVED` order. Every PO line shows
      ordered, already received and outstanding; procurement enters received and rejected
      (accepted = received − rejected, never more than outstanding — extra goes under
      rejected). Saved as a `DRAFT` (`RR-000001`, from `rr_number_seq`) with its branch and
      counter; one open RR per order. List, detail and draft edit pages; whoever saves an
      edit becomes the counter, so the no-self-approval rule holds. No stock moves until
      approval. Migration `20261029065124_week4_receiving_report` adds `branchId` to
      `ReceivingReport` and `StockMovement` and links RR lines to PO lines.
- [x] Variance detection — measured against what was **outstanding** when the delivery was
      counted (stored per line as `expectedQuantity`, migration
      `20261029220219_rr_expected_quantity`), not the ordered quantity, so a split delivery's
      second report doesn't read as short. Each line splits into short / over-delivered /
      rejected with peso values, shown on the RR page, live in the form, and as a "Match" /
      "Variance · N lines" badge on the receiving list and the order page. A rejected quantity
      needs a line note. A flag, not a block — accounting decides on approval.
- [x] RR approval — procurement submits a draft (`POST /api/receiving-reports/[id]/submit`,
      re-checking the saved counts first); accounting approves or rejects through the shared
      `POST /api/approvals` (`referenceType: 'ReceivingReport'`), from a new "Receiving reports"
      section of the inbox showing value and variance. Nobody decides a count they made
      (`receivedById`), ADMIN included; rejecting needs a reason and is terminal. Accounting can
      now read `/procurement/receiving` but not record or edit. Shipped approving the status
      only; the next task added stock to the same transaction.
- [x] Inventory ledger entry + stock update on RR approval — approval is one transaction:
      lock the PO row (`SELECT … FOR UPDATE`), move the RR's status, write the `Approval` row,
      re-check that no PO line is now accepted beyond what was ordered, then per line with
      something accepted an `IN` `StockMovement` (quantity, branch, `unitCost`, reference = the
      RR) and an atomic `InventoryLevel` upsert-increment, and finally the PO to
      `PARTIALLY_RECEIVED` / `FULLY_RECEIVED` from everything accepted so far. Any failure rolls
      all of it back (409). New `StockMovement.unitCost` (migration
      `20261030034822_stock_movement_unit_cost`). The RR page shows what reached stock. Race,
      partial, all-rejected, rejection and cancelled-order cases verified.
- [x] Every movement writes to the ledger with its source document — `StockMovement.referenceType`
      / `referenceId` are now `NOT NULL` (migration
      `20261030060104_stock_movement_reference_required`), and quantities are signed (in +,
      out −) so the balance is `SUM(quantity)`. New **Stock Ledger** page (`/inventory/ledger`,
      every role): movements newest first, paged, filtered by material and branch in the URL,
      each linked to its source document for roles that can open it; with one material at one
      branch, a running balance (SQL window function) and a ✓ / ✗ check against
      `InventoryLevel`. The RR page's Stock card links into it.
- [x] Current stock dashboard — visual map view — **Stock Levels** (`/inventory/stock`, every
      role): one panel per branch, a tile per active material coloured 🔴 out (≤ 0) / 🟡 low
      (≤ reorder point) / 🟢 healthy / ⚪ no reorder point, grouped by category, with counts, a
      reorder-alerts list (red then yellow, with the shortfall), branch/status filters in the URL,
      and a popup per tile linking to its ledger — the slot for Week 10's Reorder Recommender.
      Refreshes every 30 s (`router.refresh()`); "last movement" comes from
      `InventoryLevel.updatedAt` so a refresh never scans the ledger. "Stockout risk" means out
      of stock until usage data exists (Week 6+).
- [x] BullMQ daily low-stock check job — two daily jobs at 06:00 Asia/Manila, scheduled by the
      worker at startup (`DAILY_JOBS` in `lib/queue.ts`, BullMQ job schedulers kept in Redis):
      `low-stock-check` sends one summary per procurement manager / admin built from the stock
      map's reorder alerts, and `stock-reconciliation` tells admins when any stock level
      disagrees with its ledger total. Once per person per day (date as `referenceId`);
      `npm run job -- <name>` runs either now. Rows only — nothing shows them yet.

**Week 4 complete (2026-11-07).**

**Note (2026-11-07):** the notification bell moves forward from Week 11. Three jobs (Week 3's
PR-submitted, and both Week 4 daily jobs) write `Notification` rows that nothing displays, so a
basic in-app bell (unread count, latest notifications, mark read) is built next, before Week 5.
Week 11 keeps email (Resend) and the escalation job, building on it. Done the same day, as
real-time push rather than polling — see Week 11 below.

**Note (2026-10-30):** three API gaps from Weeks 1–2 closed — `/api/auth/register` was public and
let the caller pick any role (now ADMIN-only); item-master and BOM writes had no role guard (now
ADMIN, plus PRODUCTION_MANAGER for BOMs, via method-aware `ROLE_GUARDS`); `includeInactive=false`
was read as true. See `docs/2026-10-30-api-guards.md`.

**Note (2026-08-17):** Scope revision to the stock dashboard, carried through to Week 10's
Reorder Recommender below — see `kitchenERP-sprint-v3.jsx` (Week 4 tasks/deliverable, Week 10
Feature 4, and the `ai_features` table). Build the Week 4 dashboard as the color-coded location
map from the start rather than a plain table, so the Week 10 AI recommendation can surface inline
on it (click a 🟡/🔴 tile → see the suggestion → "Create Purchase Order"). No new DB tables —
this reuses `InventoryLevel`/`Material` data already in the schema plus the planned `ai_insights`
table; it's a UI/UX decision, not an architecture change.

---

## Phase 2 — Production & Finished Goods (Weeks 5–8)

### Week 5 — Production Order Creation
- [x] Production Order form + BOM-derived material requirements — **form done 2026-11-08**
      (`docs/2026-11-07-week5-production-orders.md`): `/production/orders` list (status filter,
      paged), new, detail and edit pages for ADMIN + PRODUCTION_MANAGER. Finished good (active BOM
      only), batch weight (defaults to the BOM's batch size) × number of batches (1–100) =
      `plannedQty` in Decimal, production date (today or later, Manila), branch, notes. Saved as
      `DRAFT`, numbered `PRD-000001` (`prd_number_seq`); drafts editable, re-pinning the active
      BOM version on every save; a BOM whose unit differs from the finished good's is refused.
      `ProductionStatus` replaced with the full flow (migration
      `20261107073325_week5_production_orders`, table was empty). **Material requirements done
      2026-11-08** (`docs/2026-11-08-week5-material-requirements.md`): every ingredient per batch
      and in total, scaled in Decimal from the BOM (`scaleBomQuantities`), derived on read and
      never stored — "Materials required" on the order page (pinned version) and a live preview
      on the new / edit forms (active version, `GET /api/production-orders/requirements`).
- [x] Stock sufficiency check + shortage alerts — **stock check done 2026-11-08**
      (`docs/2026-11-08-week5-stock-sufficiency.md`): each requirement line shows on hand at the
      order's branch, committed (what other APPROVED / IN_PROGRESS orders there still need —
      stock only leaves on completion), available = on hand − committed, and a green "Enough" /
      red "Short X", on the order page (DRAFT through IN_PROGRESS) and in the form preview
      (`branchId` on `GET /api/production-orders/requirements`). Derived, nothing reserved;
      expected deliveries not counted. **Shortage alert done 2026-11-08**
      (`docs/2026-11-08-week5-shortage-alert.md`): a red banner above the requirements (order page
      and form preview) naming every short ingredient and amount, or a green "all in stock"; short
      rows tinted. On the order page (ADMIN / PRODUCTION_MANAGER, DRAFT through APPROVED),
      "Request missing materials" opens a new purchase request pre-filled with the shortfall
      (`/procurement/requests/new?productionOrder=<id>`), reviewed and saved as usual.
- [x] Production Order approval + status flow — **approval done 2026-11-08**
      (`docs/2026-11-08-week5-production-approval.md`): production submits a draft
      (`POST /api/production-orders/[id]/submit`; saved values re-checked, a superseded BOM pin
      refused, shortages warn only) → accounting approves or rejects through `POST /api/approvals`
      (`referenceType: 'ProductionOrder'`; not the submitter, ADMIN included; a reason to reject).
      New `ProductionOrder.submittedById` (migration `20261108122903_production_order_submitted_by`).
      Accounting can now read `/production/orders`; the approvals inbox has a Production orders
      section with a shortage badge. Notifications via the queue: submitted → approvers; decided →
      submitter; approved with shortages → procurement, linking to the pre-filled request.
      Also fixed: a line's shortage is capped at the order's own requirement. **Status flow done
      2026-11-08** (`docs/2026-11-08-week5-status-flow.md`): Start (`APPROVED → IN_PROGRESS`, shortages
      warn only) and Cancel (with a reason, from DRAFT / PENDING_APPROVAL / APPROVED — not once
      started) for production; every status change is logged in the new `ProductionStatusChange`
      table in the same transaction (migration `20261108133119_production_status_change`), which
      drives a Draft → Pending → Approved → In progress → Completed timeline on the order page.
      Completing a run (with stock) is Week 6.
- [x] Production schedule calendar view — **done 2026-11-08**
      (`docs/2026-11-08-week5-production-calendar.md`): `/production/schedule`, a Sunday-first
      month grid of production orders by production date (ADMIN, PRODUCTION_MANAGER, ACCOUNTING;
      sidebar "Production Schedule"). Status-coloured chips link to each order; day totals summed
      in Decimal per unit; branch filter and "show rejected & cancelled" in the URL; "+" on today
      and later days opens the new-order form with that date. One query over the visible weeks
      (capped at 500) using the new `ProductionOrder(plannedDate)` index (migration
      `20261108141128_production_order_planned_date_index`). No date library added.

**Week 5 complete (2026-11-08).**

### Week 6 — Production Execution & Basic Costing
- [x] Execution flow (In Progress → Completed) with stock deduction/addition — *Start (→ In Progress)
      was built in Week 5 Task 6.* **Completion report done 2026-11-09**
      (`docs/2026-11-09-week6-report-completion.md`): production reports an in-progress run done with
      its actual yield (`POST /api/production-orders/[id]/complete`, > 0 and ≤ 2 × planned) → new
      status `PENDING_COMPLETION`, recording `actualQty`, `completedAt` and the new `completedById`
      (migration `20261109054500_production_completion_pending`), logged through `transition()`.
      Decided: **stock moves only when accounting approves the completion** (like receiving), so a
      completion-pending run still counts as committed and nothing is deducted yet. **Sign-off and
      stock done 2026-11-09** (`docs/2026-11-09-week6-completion-approval.md`): accounting decides a
      reported completion through `POST /api/approvals` (`referenceType: 'ProductionCompletion'`; never
      whoever reported it). Approve → `COMPLETED` and, in one transaction, one `OUT` per ingredient of
      the pinned BOM at the planned quantity (stock may go negative; the approver is warned) and the
      actual yield into new lot-tracked finished-goods stock (`FinishedGoodLot` / `FinishedGoodLevel` /
      `FinishedGoodMovement`, migration `20261109083000_finished_good_stock`). Reject → back to
      `IN_PROGRESS` with a reason. Approval preview and "Stock moved" card on the order page, a
      Production completions section in the inbox, the new **Finished Goods** page, PRD links in the
      Stock Ledger, finished goods in the daily reconciliation, and notifications both ways.
- [x] Batch/expiry tracking on finished goods — *lot number (= the order number) and production date
      done 2026-11-09 with the sign-off.* **Expiry done 2026-11-09**
      (`docs/2026-11-09-week6-finished-goods-expiry.md`): `FinishedGood.shelfLifeHours` (1–720 h, set in
      Master Data); each lot's `expiresAt` = the moment its run was reported done + the shelf life,
      stored at approval (migration `20261109150000_finished_good_expiry`); approval refused while
      the finished good has no shelf life. Finished Goods lists lots soonest to expire first with an
      Expires column and an Expired badge. The 24/48 h warnings are Week 7.
- [x] Actual vs planned yield — **done 2026-11-09** with the completion report: "9.6 kg of 10 kg planned ·
      −0.4 kg (96%)" on the order page, computed in Decimal; the timeline shows the yield reported.
- [x] Costing: batch cost, cost/kg, variance — **done 2026-11-09**
      (`docs/2026-11-09-week6-production-costing.md`): the pinned BOM at the deducted quantities × the
      reference `ItemPrice` in force on the date — planned on the production date, batch cost on the
      day it was produced; cost/kg = batch cost ÷ actual yield; variance = batch cost − planned
      cost/kg × actual yield. An estimate on open orders, the figures approving would record while a
      completion waits, and **recorded at approval** (new `ProductionOrder.plannedCost`, `actualCost`,
      `costPerUnit`, `costVariance`, migration `20261109120000_production_costing`; prices on the
      ingredient `OUT` rows and cost/kg on the lot's `IN`), never recomputed. A missing price blocks
      approval. Costing card on the order page, cost line in the approval preview, unit cost in the
      inbox, unit cost and value on Finished Goods. Also fixed: `formatPeso` rounded half-centavos
      down (float); it now rounds on the digits.
- [x] Accounting approval of completion — **done 2026-11-09** with the stock movements (see the first item).

**Week 6 complete (2026-11-09).**

### Week 7 — Conversion, Write-off & Expiry
- [x] Conversion order + costing — **done 2026-11-12** (`docs/2026-11-12-week7-conversion-orders.md`),
      covering the roadmap's "Conversion order…", "COSTING: record conversion cost…" and "Conversion
      approval by accounting". Lechon is a finished good, roasted through ordinary production orders
      (its master data and BOM were entered through the app). A BOM now has a **kind**: Lechon Paksiw
      keeps its production recipe and gains a **conversion** recipe (Conversion v1: 6 kg Lechon + the
      added ingredients per 10 kg); versions are numbered per kind and production planning only sees
      production recipes. There is no BOM editor — conversion recipes go in through `POST /api/boms`.
      Production → **Conversions**: production records a conversion already done (recipe, branch, kg
      used, kg made — no draft), with a live preview of the source lots soonest-to-expire first
      (expired lots skipped), the added ingredients scaled by kg used ÷ 6, the cost and the output lot;
      it goes straight to accounting as `CNV-000001`. Submit checks enough unexpired source is on hand
      at the branch, less what other pending conversions have claimed. Accounting approves or rejects
      through `POST /api/approvals` (`referenceType: 'ConversionOrder'`; never whoever recorded it;
      reason to reject; rejection is final — production records it again). Approval is one
      transaction: the source lots are locked and re-planned (short → 409), taken out at their recorded
      cost, the added ingredients go out at reference prices on the conversion date (may go negative),
      the output comes in as lot `CNV-…` expiring its shelf life after the conversion, and the source
      cost, conversion cost and cost per kg are recorded. Inbox section, Stock moved card,
      notifications both ways, CNV links on Finished Goods and the Stock Ledger. Migration
      `20261112090000_conversion_orders`.
- [x] Write-off workflow + costing — **done 2026-11-12** (`docs/2026-11-12-week7-write-offs.md`), covering the
      roadmap's "Write-off workflow…", "COSTING: write-off cost…" and "Write-off approval by accounting".
      Finished-goods lots only (raw-material write-offs come with stock adjustments). A **Write off** button
      on each lot of Finished Goods (ADMIN, PRODUCTION_MANAGER) opens a form pre-filled from the lot: quantity
      (part of a lot allowed), reason (Expired · Spoiled · Damaged · Failed quality · Other — a note required
      for Other; Expired pre-selected on an expired lot), notes. Recording submits it (`WO-000001`, no draft);
      the quantity must not exceed what the lot holds less other pending write-offs of it, and conversions now
      count pending write-offs of unexpired lots as claimed. Accounting approves or rejects through
      `POST /api/approvals` (`referenceType: 'WriteOff'`; never whoever recorded it; reason to reject; rejection
      final). Approval is one transaction: the lot is locked and rechecked (short → 409), one `WASTE` movement
      takes the quantity out at the lot's recorded cost, and `unitCost` / `totalCost` are recorded.
      **Inventory → Write-offs** lists them with the peso value written off (approved) and value per row, with
      status and reason filters; the detail page has the approval preview, Approve / Reject, the decision and
      a Stock moved card. Inbox section, notifications both ways, "N kg pending write-off" on Finished Goods
      lots. Migration `20261112150000_write_offs`.
- [x] Expiry tracking (24/48h flags) — **done 2026-11-12** (`docs/2026-11-12-week7-expiry-flags.md`). Each lot is
      **Expired**, **within 24 h** (use or convert today), **within 48 h**, or fine — worked out on every read
      against one clock (`expiryFlag` in `lib/dates.ts`), nothing stored. Finished Goods shows the badge
      ("Expires in 9 h") with tinted rows and chips ("1 expired · 1 within 24 h · 1 within 48 h") that filter
      the lots (`?expiry=`); the conversion form's source lots, the write-off form and the write-off page show
      the same badge. A new daily job, `expiry-check` (06:00 Manila), sends each production manager and admin
      one summary of the lots to sell, convert or write off, most urgent first, with the value at cost — once
      per person per day, nothing when nothing is flagged; `npm run job -- expiry-check` runs it now. Fixed
      thresholds of 24 / 48 h for every product, so Lechon (48 h shelf life) is "within 48 h" from roasting.
      No schema change.
- [x] End-of-day reconciliation — **done 2026-11-13** (`docs/2026-11-13-week7-end-of-day.md`). **Inventory → End of
      Day** (every role): one Manila business day of finished goods per good and branch, from the ledger alone —
      opening, produced, converted in, converted out, written off, distributed (transfers, from Week 8), closing —
      in kg and at each lot's recorded cost, with a value-at-cost totals row. A movement counts on the day
      accounting approved it. A Check column proves opening + the day's flows = closing (a ledger movement that
      fits no flow shows "Unrecognised") and, for today, that closing = what the stock levels hold ("Stock
      differs"). ‹ › and a date picker move between days; a branch filter. Below it, the documents behind the
      figures — PRD / CNV / WO with quantity, lots and value, linked for admin, production and accounting. A new
      daily job, `end-of-day-summary` (21:00 Manila), sends each production manager, accountant and admin the
      day's figures and closing value — once per person per day, nothing on a day with no movement; the bell
      opens that day. Books only: no physical count (with the stock-adjustment follow-up). No schema change.

### Week 8 — Branch Distribution & Costing Dashboard
- [x] Branch management — **done 2026-11-13** (`docs/2026-11-13-week8-branch-management.md`). Master Data → **Branches**
      (ADMIN): every branch with code, name, type, address, phone, manager and status. A branch gains a unique
      **code** (2–10 letters/digits, fixed once created; Main Commissary is `MAIN`), a **type** — Commissary (supplies
      the others) or Outlet; every branch cooks, so no form is restricted by type — a phone, and one **manager**
      (`Branch.managerId`, unique: one manager per branch, one branch per manager; choosing a manager of another
      branch moves them); names are unique ignoring case. New / Edit popup; `GET/POST /api/branches`,
      `PATCH /api/branches/[id]`. **Deactivate** (never delete) is refused while the branch holds stock or has open
      production orders, receiving reports, conversions or write-offs — inventory pages list active branches only,
      so its stock would vanish — and for the last active commissary (rows locked; race-tested); the message names
      what to clear. Reactivate any time. Migration `20261113100000_branch_profiles`.
- [~] Transfer Order + approval + variance logging — **Transfer Order done 2026-11-14**
      (`docs/2026-11-14-week8-transfer-orders.md`); approval / dispatch / receipt (Task 3) and variance (Task 4) to
      do. **Inventory → Transfers** (ADMIN, PRODUCTION_MANAGER, ACCOUNTING; a BRANCH_MANAGER sees only transfers to
      or from the branch they manage, read from `Branch.managerId`): the kitchen records what it sends from an
      active **commissary** to another active branch — one line per finished good, quantity — and saving submits it
      to accounting as `TRF-000001` (`trf_number_seq`, no draft). The form shows, live, what the sender can send
      (unexpired on hand − pending conversions, write-offs of unexpired lots and other transfers), the lots each line
      would take **soonest expiry first, never expired**, and their value at lot cost; over-asking is refused. Detail
      page with the same plan while pending; list filters by status and branch. **No stock moves yet** — Task 3
      takes it out of the sender on approval and into the receiver on receipt, as `TRANSFER` movements End of Day
      counts as Distributed. Conversions now count pending transfers as claimed; open transfers block branch
      deactivation. The unused Week 1 material `StockTransfer` / `StockTransferItem` were reshaped for finished goods
      (migration `20261114090000_transfer_orders`). **Approval and receipt done 2026-11-14**
      (`docs/2026-11-14-week8-transfer-approval-receipt.md`): accounting decides through `POST /api/approvals`
      (`referenceType: 'StockTransfer'`; never whoever recorded it; reason to reject; rejection final). **Approving
      dispatches**, in one transaction: each line's lots at the sender are locked and re-planned soonest expiry first
      (expired skipped) — any line short refuses it (409) — and leave as `TRANSFER −` movements at the lot's cost. The
      transfer is then **in transit**; the receiving branch's **manager** (`Branch.managerId`) **or an admin** confirms
      receipt (`POST /api/transfers/[id]/receive`) and the same lots — number, expiry, cost — arrive as `TRANSFER +`
      (all of it; partial receipt and variance are Task 4). `StockTransfer.receivedById` / `receivedAt` (migration
      `20261114150000_transfer_receipt`). Inbox section, Approve / Reject and Confirm received on the detail page, a
      Stock moved card (out / in transit / in), notifications (submitted → approvers; approved → recorder and the
      receiving manager; rejected / received → recorder), TRF numbers and links on End of Day and in the bell.
      Variance (Task 4) to do.
- [ ] Per-branch inventory view
- [ ] Costing dashboard

---

## Phase 3 — KitchenAI + Reports + Deploy (Weeks 9–12)

### Week 9 — KitchenAI Core Intelligence
- [ ] Claude API integration (Anthropic SDK)
- [ ] Cost Variance Explainer
- [ ] Natural Language Query + 6 read functions
- [ ] AI write actions — `create_purchase_request`, `create_production_order`, confirm-before-execute
- [ ] AI query log table (incl. action type, confirmed/cancelled, created document id)
- [ ] Streaming NL query UI

### Week 10 — KitchenAI Predictive Features
- [ ] Waste Pattern Detector (weekly BullMQ job)
- [ ] Reorder Recommender — surfaces inline on the Week 4 stock map (click a location → AI suggestion → one-click Create Purchase Order)
- [ ] Demand Forecaster
- [ ] Supplier Performance Analyzer (monthly BullMQ job)
- [ ] Decision Simulator — what-if batch plan vs live BOM/stock/prices; shortages, cost, cost/kg, resulting stock (read-only)
- [ ] AI badge + Regenerate button on all AI insights

**Note (2026-08-17):** KitchenAI goes from 6 features to 7 — see `kitchenERP-sprint-v3.jsx`.
Two additions, both to the AI layer:
1. **Write actions** (Week 9) — the NL query assistant gets 2 action functions on top of its 6
   read functions, so it can draft documents rather than only answer questions. Every write is
   confirm-before-execute: Claude returns a filled draft, the user confirms, and the document is
   created under that user's identity and enters the normal approval flow. Nothing auto-executes
   and no approval step is bypassed. This is also what makes the "Create Purchase Order" button
   on the Week 4 stock map work end to end.
2. **Decision Simulator** (Week 10, Feature 7) — what-if production planning against live BOM,
   stock and price data. Read-only; writes nothing to inventory. Depends on Weeks 5–8 (BOM,
   costing) being complete.

No new tables beyond the already-planned AI ones; `ai_query_log` gains `action_type`,
`confirmed`, and `created_document_id` for write-action audit. Workflow gamification and 3D
were considered and deliberately dropped.

### Week 11 — Approvals Hub & Reports
- [ ] Unified approvals inbox
- [~] Notification bell + email (Resend) — **bell done 2026-11-07**, pulled forward
      (`docs/2026-11-07-notification-bell.md`): unread badge and latest 15 in the top bar,
      pushed live (Redis pub/sub → Server-Sent Events → `EventSource`), mark one / all read.
      Email via Resend still to do here.
- [ ] Escalation job (24h+ pending)
- [ ] 5 reports with CSV/PDF export
- [ ] End-of-day branch snapshot report
- [ ] Weekly report scheduler

### Week 12 — Deploy, Polish & Portfolio
- [ ] AWS deploy (EC2, RDS, S3)
- [ ] CI/CD to main
- [ ] PWA setup
- [ ] UI polish (loading/empty/error states)
- [ ] Realistic seed data (3 branches, 30 days history)
- [ ] README + architecture diagram
- [ ] Demo video + LinkedIn post
