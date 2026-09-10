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

---

## Commit 2 — Purchase Request creation (list, form, API, service, repository)

The first slice of application code. A user can raise a DRAFT purchase request and see it
listed. Submit/approve transitions are deliberately excluded — they are their own commit.

**Two decisions taken here**

| Decision | Chosen | Why |
|---|---|---|
| When `prNumber` is assigned | At **creation**, not at submission | A PR that cannot be referred to by number is awkward in the UI and in the audit trail. Sequences already produce gaps on rollback, so abandoned drafts leaving gaps costs nothing. |
| `estimatedUnitCost` on lines | **Auto-filled** from `ItemPrice` when the caller supplies none | An approver looking at an uncosted request cannot judge it. This is where Week 2 pays off: `ItemPriceRepository.findPricesAsOf` prices every line in one supplier-aware query with reference-price fallback. A caller-supplied cost still wins. |

Also settled: the sprint plan's "PR form: items + quantities + **urgency** + notes" is served by
the existing `neededBy` date rather than a new urgency enum. A date is actionable and objective;
a self-assessed urgency label is neither, and everyone ticks "urgent".

**What changed**

- `repositories/purchase-request.repository.ts` (new) — `findMany` (paginated, newest first),
  `findById`, `create` (nested line insert in one statement), and `nextPrNumber()`, which reads
  `pr_number_seq` via `$queryRaw`. Two include shapes: full detail for one PR, a lighter one for
  list rows that still carries line quantity/cost so the service can total each row without a
  per-row query.
- `services/purchase-request.service.ts` (new) — `list`, `getById`, `create`. Validates line
  count, duplicate materials and non-positive quantities; resolves all materials in one
  `findManyByIds` and all prices in one `findPricesAsOf`. Converts every `Decimal` to a string
  and every `Date` to an ISO string before returning. `estimatedTotal` is null when *any* line is
  unpriced — a partial total would understate the request.
- `app/api/purchase-requests/route.ts` (new) — `POST`. Reads `x-user-id` from the header
  middleware injected, zod-validates the body, delegates, maps the service result to 201/400/401/500.
- `app/(protected)/procurement/requests/page.tsx` (new) — Server Component list.
  **Correction:** this file shipped in commit 2 still rendering hardcoded placeholder rows;
  the service call landed in commit 3 below.
- `app/(protected)/procurement/requests/new/page.tsx` (new) — Server Component that loads
  materials and renders the form.
- `components/procurement/PurchaseRequestForm.tsx` (new) — Client Component. Repeating line
  rows, live estimated total, `fetch` on submit, `router.refresh()` after success.
- `lib/navigation.ts` — Purchase Requests link opened to the roles that can raise one.

**Why `fetch` + an API route rather than a Server Action**

Server Actions POST to the *current page URL*, so `middleware.ts` sees the page path, not an
action-specific one. The `ROLE_GUARDS` design — especially routing every approve/reject through
a single guarded `/api/approvals` — cannot work that way, and each action would need an inline
role check, which `docs/coding-conventions.md` forbids. API routes are also plain URLs, which
Week 9's `create_purchase_request` AI tool needs; a Server Action is only callable from inside
the React tree. Reads still go through Server Components — no `fetch` for those.

`axios` was considered and rejected: ~13 KB shipped for ergonomics this app does not need. Its
main draw is interceptors attaching a bearer token, and auth here is an httpOnly cookie the
browser sends automatically.

**Database changes**

None. Uses the tables and sequence from commit 1.

**API changes**

New: `POST /api/purchase-requests`. Body `{ notes?, neededBy?, items: [{ materialId, quantity,
estimatedUnitCost?, notes? }] }`. Returns `201 { purchaseRequest }`. `requestedById` is taken
from the `x-user-id` header and never from the body — otherwise a caller could raise a request
in another user's name. Guarded by `middleware.ts` to ADMIN, PROCUREMENT_MANAGER,
BRANCH_MANAGER, PRODUCTION_MANAGER, ACCOUNTING.

**UI changes**

- `/procurement/requests` — table of requests with status badges and estimated totals.
- `/procurement/requests/new` — line-item form with a live estimate as you type.
- Sidebar now shows Purchase Requests to requester roles.

**How to verify**

```bash
npx tsc --noEmit && npm run lint && npm run build && npm start
```

Log in as `branch@kitchen.com` / `password123`, go to Purchase Requests → New Request, add two
lines (Pork Belly 25, Garlic 3) leaving costs blank, save. Expect `PR-000002` in the list with
2 lines and ₱10,040.00 — 25 × 380 + 3 × 180, both prices auto-filled from `ItemPrice`. Confirm:

```bash
docker compose exec postgres psql -U kitchen -d kitchen_erp \
  -c 'SELECT pr."prNumber", count(i.id) FROM "PurchaseRequest" pr
      LEFT JOIN "PurchaseRequestItem" i ON i."purchaseRequestId" = pr.id
      GROUP BY pr.id, pr."prNumber" ORDER BY pr."prNumber";'
```

**Risks / follow-up**

- A half-filled line (material but no quantity, or vice versa) originally got dropped silently
  from the payload. Now it blocks submission with a message. This is convenience validation
  only — the server revalidates via zod and the service.
- No ownership check yet on reads: any role that can reach the list sees every request, not just
  their own. Fine while the only consumers are the requester and the approver, but the inbox
  commit should decide whether a BRANCH_MANAGER may read another branch's requests
  (`docs/database.md` notes branch is not a security boundary today).
- No detail page yet, so list rows are not clickable and `PurchaseRequestService.getById` has no
  UI caller.
- No edit or delete for a draft.
- The list is capped at `take: 100` with no pagination controls; the repository supports
  `skip`/`take` but nothing drives them.


---

## Commit 3 — viewer scoping, and the list page actually reading the database

**What changed**

- `services/purchase-request.service.ts` — added a `Viewer` type (`userId` + `role`) and
  scoping. `list()` now takes a viewer and narrows the query to `requestedById` unless the
  role is ADMIN, ACCOUNTING or PROCUREMENT_MANAGER. `getById()` applies the same rule and
  returns **404, not 403**, when a requester opens someone else's PR — a 403 would confirm the
  id exists, which is more than they are entitled to know.
- `app/(protected)/procurement/requests/page.tsx` — replaced the placeholder rows with a real
  `PurchaseRequestService.list()` call, reading identity via `getSession()`.
- Dropped `max-w-6xl` / `max-w-4xl` from both procurement pages, matching the width change
  applied to the other pages.

**Why scoping lives in the service**

A page or handler that forgot to pass `requestedById` would silently list every request. Putting
the decision inside `list()` makes the safe behaviour the default and the unsafe one impossible
to reach by omission. This is per-**user** ownership, not branch isolation — `docs/database.md`
still notes branch is not a security boundary.

It is scoping rather than secrecy: a branch manager's list stays useful instead of filling with
other people's requests, while accounting and procurement keep the whole picture.

**Correction to commit 2**

`app/(protected)/procurement/requests/page.tsx` was committed in 602581a still rendering
hardcoded placeholder rows, although that commit's message and this note both described it as
calling the service. The step was written but never applied, and verification at the time went
through `psql` rather than the page, so it went unnoticed. Fixed here.

**How to verify**

```bash
npx tsc --noEmit && npm run lint && npm run build && npm start
```

- As `branch@kitchen.com`: `/procurement/requests` lists only requests that user raised.
- As `accounting@kitchen.com` or `admin@kitchen.com`: the same page lists every request.
- Both should show real rows from the database, not placeholders.

**Risks / follow-up**

- `PurchaseRequestService.getById` is scoped but still has no UI caller — the detail page is
  the next commit.
- A `VIEWER` is blocked from the page by `middleware.ts`, so the role is absent from
  `ROLES_SEEING_ALL_REQUESTS` by design; if VIEWER is ever allowed read access, it must be
  added there deliberately rather than inheriting the requester scope.

---

## Commit 4 — PR detail page and submit-for-approval

Built top-down — view, then the button's `fetch` (which 404'd until the endpoint existed), then
the endpoint as a stub, then the service and repository — so each layer was visibly reached in
the browser before the next was written.

**What changed**

- `components/procurement/StatusBadge.tsx` (new) — the status pill, extracted from the list page
  because the detail page and the upcoming PO pages need the same thing. Covers both `PRStatus`
  and `POStatus`. Not a Client Component: it has no interactivity, so it ships no JavaScript.
- `app/(protected)/procurement/requests/page.tsx` — uses `StatusBadge`; each PR number now links
  to its detail page.
- `app/(protected)/procurement/requests/[id]/page.tsx` (new) — detail page. Awaits `params`
  (a Promise in Next.js 15), reads the viewer via `getSession()`, calls
  `PurchaseRequestService.getById`, and calls `notFound()` on any failure.
- `app/(protected)/procurement/requests/not-found.tsx` (new) — rendered by `notFound()`. Placed
  at `requests/` rather than the app root so it renders inside the protected layout and keeps the
  sidebar. Its wording covers both "does not exist" and "not yours" without saying which.
  Before it existed, a refused PR rendered a blank page.
- `components/procurement/PurchaseRequestActions.tsx` (new) — Client Component holding only the
  Submit button. Calls the endpoint, then `router.refresh()` so the Server Component re-runs and
  the badge updates in place.
- `app/api/purchase-requests/[id]/submit/route.ts` (new) — `POST`, no body. Reads `x-user-id`
  and `x-user-role`, delegates to the service.
- `services/purchase-request.service.ts` — `submit(id, viewer)`.
- `repositories/purchase-request.repository.ts` — `updateStatus(id, status)`. Deliberately
  carries no rules; which transitions are legal is decided in the service.

**Why a dedicated `/submit` endpoint rather than `PATCH { status }`**

A general update endpoint that accepts a status would let a requester send
`{ "status": "APPROVED" }` and approve their own request. Giving each transition its own URL is
what makes path-prefix authorization possible: submitting is the requester's action at
`/api/purchase-requests/[id]/submit`; approving will be accounting's at `/api/approvals`, which
`middleware.ts` already restricts to ACCOUNTING and ADMIN.

**The four failure codes**

| Code | When |
|---|---|
| 404 | PR missing, or not visible to this viewer. Indistinguishable on purpose — a 403 would confirm the id exists. |
| 403 | Visible but not yours to submit. Accounting can *see* every request but must not submit one; ADMIN may act for anyone. |
| 409 | Not a draft any more — a stale tab or a double-click. The payload was valid; the resource's state has moved on, so retrying identically fails identically. |
| 400 | No lines. Cannot happen today (create requires one and lines are not editable), but costs nothing and protects the future edit feature. |

The ownership check is repeated in `submit` even though `getById` already scopes reads, because
the endpoint can be called directly without ever loading the page.

**Database changes**

None. Uses the existing `PurchaseRequest.status` column and its index.

**API changes**

New: `POST /api/purchase-requests/[id]/submit` — no body. `200 { purchaseRequest }` on success;
404 / 403 / 409 / 400 as above. Covered by the existing `/api/purchase-requests` guard in
`middleware.ts`.

**UI changes**

- PR numbers in the list are links.
- `/procurement/requests/[id]` shows header, notes, lines with unit cost and line total, and an
  estimated total. A **Submit for approval** button appears for drafts only.
- A readable not-found message replaces the blank page for refused or missing PRs.

**Related fix, separate commit**

`2ec9e21` adds `accounting@kitchen.com` to the dev quick-login list on `/login`. Commit 1 seeded
the account but never updated that hardcoded list.

**How to verify**

```bash
npx tsc --noEmit && npm run lint && npm run build && npm start
```

1. As `admin@kitchen.com`, create a request, open it from the list, click **Submit for
   approval**. The badge changes to `PENDING APPROVAL` without a page reload and the button
   disappears.
2. Open another draft in two tabs. Submit in one, then click Submit in the other — expect
   *"This request is already pending approval and cannot be submitted again"* (409).
3. Copy a detail URL owned by admin, then open it as `branch@kitchen.com` — expect the
   not-found message with HTTP 404. As `accounting@kitchen.com` it opens, with no Submit button.

```bash
docker compose exec postgres psql -U kitchen -d kitchen_erp \
  -c 'SELECT "prNumber", status FROM "PurchaseRequest" ORDER BY "prNumber";'
```

**Risks / follow-up**

- `PENDING_APPROVAL` is currently a dead end: nothing can approve or reject yet. The inbox and
  `POST /api/approvals` are next.
- Submitting writes no `Approval` row, by design — an `Approval` records a *decision*, and
  submission is not one.
- Edit and delete for drafts were agreed to land in this slice and have not. A typo still means
  abandoning the draft, which burns a PR number and leaves a stray DRAFT in the list.
- Hiding the Submit button for non-drafts is convenience only; the service's 409 is the real
  guard.
