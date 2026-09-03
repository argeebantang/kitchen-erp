# Week 3 — Purchase Request & Purchase Order

Delivered in focused commits. This note is appended to as each lands.

## Design decisions settled before building

| Area | Decision | Rationale |
|---|---|---|
| Roles | New `ACCOUNTING` role | Requester, sourcer and approver must be three different people. The sprint plan called for an "Accounting Approver" that the Week 1 enum never had; without it a `BRANCH_MANAGER` raising a PR was bounced to `/unauthorized`. Adding an enum value is additive and touches no existing rows. |
| Approval model | `Approval` made polymorphic (`referenceType` + `referenceId`); the PR foreign key dropped | Week 3 needs approvals on `PurchaseOrder` as well as `PurchaseRequest`, and Weeks 6–7 will need them on `ProductionOrder` and `Conversion`. One table beats four near-identical ones. Mirrors the existing `StockMovement.referenceId` / `referenceType` pattern (`docs/database.md`). |
| PR → PO | PR approval auto-generates one `DRAFT` PurchaseOrder; `PurchaseOrder.supplierId` made nullable | A PO row cannot carry a required `supplierId` that the PR never had. Procurement fills in supplier + delivery on the draft; the service will block `DRAFT → PENDING_APPROVAL` while `supplierId` is null. |
| Document numbers | Postgres sequences `pr_number_seq` / `po_number_seq`, formatted `PR-000001` in the app | `count()+1` issues the same number twice when two users submit simultaneously. `nextval()` is atomic. Sequences are gap-tolerant (a rolled-back transaction burns a number), which is fine — uniqueness matters, contiguity does not. |
| Notifications | New `Notification` table; the BullMQ job will write rows | A queue with no sink is a hollow exercise. Week 11's notification bell + Resend email build on this table, and the low-stock / escalation / waste jobs reuse it. |
| Approval authorization | All approve/reject actions will go through `POST /api/approvals` | A middleware prefix guard can express "only ACCOUNTING may hit `/api/approvals`", but cannot distinguish "create a PR" from "approve a PR" on a shared resource path. Keeps authorization in `middleware.ts` instead of scattering per-handler role checks (`docs/coding-conventions.md`). |
| PDF export | `@react-pdf/renderer` instead of the plan's Puppeteer | A PO is a header + supplier block + line-item table + totals. `@react-pdf/renderer` is ~2 MB with no browser binary and renders fast enough to skip the queue; Puppeteer's ~300 MB Chromium is only worth it for arbitrary-HTML fidelity. Deferred to the PDF commit. |

---

## Commit 1 — schema foundation

No feature code. This commit only makes the database able to express the Week 3 workflow.

**What changed**

- `Role` enum: added `ACCOUNTING`.
- `POStatus` enum: added `PENDING_APPROVAL`, `APPROVED`, `REJECTED`. Intended lifecycle:
  `DRAFT → PENDING_APPROVAL → APPROVED → SENT → PARTIALLY_RECEIVED → FULLY_RECEIVED`,
  with `REJECTED` terminal and `CANCELLED` reachable from any live state.
  (`PRStatus` already had its approval states from Week 1 — unchanged.)
- `Approval`: dropped `purchaseRequestId` (column + FK), added `referenceType` and
  `referenceId`, added `@@index([referenceType, referenceId])`. Removed the now-impossible
  `PurchaseRequest.approvals` relation field.
- New `Notification` model — `userId` (real FK to `User`), `type`, `title`, `body?`,
  `referenceType?`, `referenceId?`, `readAt?` (null = unread), `createdAt`, plus
  `@@index([userId, readAt])`.
- `PurchaseOrder.supplierId` / `supplier` made optional.
- Seven indexes added for the inbox and join queries Week 3 introduces:
  `PurchaseRequest.status`, `PurchaseRequest.requestedById`, `PurchaseOrder.status`,
  `PurchaseOrder.supplierId`, `PurchaseOrder.purchaseRequestId`,
  `PurchaseRequestItem.purchaseRequestId`, `PurchaseOrderItem.purchaseOrderId`.
  Postgres does not auto-index foreign keys, so without these every join is a sequential scan.
- Sequences `pr_number_seq` and `po_number_seq` created via SQL hand-appended to the
  migration — Prisma's schema language has no syntax for a standalone sequence.
- Seed: added `accounting@kitchen.com` (`ACCOUNTING`, password `password123`).
- `middleware.ts`: replaced the single `/procurement` guard with layered guards, and added
  guards for the Week 3 API prefixes.

**Files affected**

- `prisma/schema.prisma`
- `prisma/migrations/20260902113746_week3_procurement_workflow/migration.sql` (new)
- `prisma/seed.ts`
- `middleware.ts`
- `docs/progress.md`, `docs/2026-09-03-week3-procurement.md`

**Database changes**

Migration `20260902113746_week3_procurement_workflow`, created with
`prisma migrate dev --create-only`, hand-edited to append the two `CREATE SEQUENCE`
statements, then applied with `prisma migrate dev`.

Four enum-value additions, one destructive column drop, one `NOT NULL` relaxation, one new
table, nine new indexes, two sequences. No existing row was altered.

The destructive part — `ALTER TABLE "Approval" DROP COLUMN "purchaseRequestId"` plus two
`ADD COLUMN ... NOT NULL` — is only valid because `Approval` held zero rows (verified with
`SELECT count(*)` before running). Against real data this would have needed the additive
path: add the columns nullable, backfill `referenceId = purchaseRequestId` and
`referenceType = 'PurchaseRequest'`, then drop the old column and tighten to `NOT NULL`.

**Authorization changes**

`ROLE_GUARDS` entries are checked in a loop that tests *every* matching prefix, so
overlapping guards are AND-ed. That is used deliberately: `/procurement` sets the baseline
(all procurement roles, no `VIEWER`), and narrower guards restrict sub-paths.

| Path | Allowed roles |
|---|---|
| `/procurement`, `/api/purchase-requests` | ADMIN, PROCUREMENT_MANAGER, BRANCH_MANAGER, PRODUCTION_MANAGER, ACCOUNTING |
| `/procurement/orders`, `/api/purchase-orders` | ADMIN, PROCUREMENT_MANAGER, ACCOUNTING |
| `/procurement/approvals`, `/api/approvals` | ADMIN, ACCOUNTING |
| `/procurement/receiving` | ADMIN, PROCUREMENT_MANAGER (unchanged, Week 4) |

Net effect: procurement builds the PO, but only accounting can approve it — enforced at the
URL, not merely hidden in the sidebar.

**API changes**

None yet. The new guard entries reserve `/api/purchase-requests`, `/api/purchase-orders` and
`/api/approvals`; the handlers arrive in later commits.

**UI changes**

None. No procurement pages exist yet, and `lib/navigation.ts` is untouched — sidebar entries
land with the pages.

**Config / environment changes**

None.

**How to verify**

```bash
npx prisma migrate status          # 3 migrations, up to date

docker compose exec postgres psql -U kitchen -d kitchen_erp \
  -c 'SELECT unnest(enum_range(NULL::"Role"));' \
  -c '\d "Approval"' \
  -c '\ds' \
  -c 'SELECT email, role FROM "User" WHERE role = '"'"'ACCOUNTING'"'"';'

npx tsc --noEmit && npm run lint && npm run build
```

Expected: `Role` has 6 values; `Approval` has `referenceType`/`referenceId` and no
`purchaseRequestId`; `pr_number_seq` and `po_number_seq` are listed; the accounting user
exists.

**Risks / assumptions / follow-up**

- `Approval.purchaseRequestId` was dropped in one step rather than deprecated in two
  (contra `docs/database.md`). Justified only because the table was empty pre-first-deploy;
  do not treat this as precedent once the app holds real data.
- Dropping the `NOT NULL` on `PurchaseOrder.supplierId` also changed the FK's delete rule
  from `ON DELETE RESTRICT` to `ON DELETE SET NULL`. Hard-deleting a supplier now nulls its
  POs' `supplierId` instead of being blocked. Suppliers are soft-deleted via `isActive` in
  practice, so this should not arise — but it is a real behavioural change.
- "A PO must have a supplier" is no longer a database guarantee. The service layer must
  enforce it on the `DRAFT → PENDING_APPROVAL` transition; nothing enforces it today.
- `Approval.referenceId` has no foreign key, so the database cannot guarantee it points at a
  live row. The service layer is responsible — same contract `StockMovement` already carries.
- The sequences are invisible to `prisma migrate diff` (verified empirically), so they cause
  no schema drift, but they are also not represented in `schema.prisma`. Anyone reading only
  the schema will not know they exist — hence this note and the comment in the migration.
- `prisma/migrations/migration_lock.toml` has an unrelated pre-existing local modification
  (Prisma changed the comment wording); deliberately left out of this commit.
