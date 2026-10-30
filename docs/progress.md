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
| Production costing fields | **Partial.** `ProductionOrder` has `actualQty` but no `actualCost`, `costPerUnit`, or `costVariance`. Add columns, or a `production_actuals` table if actuals need their own audit row. | Week 6 |
| Conversion costing + approval | **Partial.** `Conversion` exists but has no `conversionCost`, `status`, or `approvedById` — it currently records a conversion, it can't route one for approval. | Week 7 |
| `writeoffs` | **Missing** entirely. | Week 7 |
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
- [ ] Current stock dashboard — visual map view (branches/storage locations as a color-coded grid: 🟢 healthy / 🟡 low / 🔴 stockout risk), not just a table
- [ ] BullMQ daily low-stock check job

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
- [ ] Production Order form + BOM-derived material requirements
- [ ] Stock sufficiency check + shortage alerts
- [ ] Production Order approval + status flow
- [ ] Production schedule calendar view

### Week 6 — Production Execution & Basic Costing
- [ ] Execution flow (In Progress → Completed) with stock deduction/addition
- [ ] Batch/expiry tracking on finished goods
- [ ] Actual vs planned yield
- [ ] Costing: batch cost, cost/kg, variance
- [ ] Accounting approval of completion

### Week 7 — Conversion, Write-off & Expiry
- [ ] Conversion order + costing
- [ ] Write-off workflow + costing
- [ ] Expiry tracking (24/48h flags)
- [ ] End-of-day reconciliation

### Week 8 — Branch Distribution & Costing Dashboard
- [ ] Branch management
- [ ] Transfer Order + approval + variance logging
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
- [ ] Notification bell + email (Resend)
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
