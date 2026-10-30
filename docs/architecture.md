# Architecture

## Overview

KitchenERP is a single Next.js 15 application (App Router) that serves both the UI and the API from one deployable unit, plus one background worker process for queued jobs. Server code is organized into three layers so that HTTP concerns, business rules, and data access stay separate:

```
Route Handler (app/api/**/route.ts)
        ↓ validates input (zod), maps result → HTTP
Service (services/*.service.ts)
        ↓ business rules, orchestration, DTOs
Repository (repositories/*.repository.ts)
        ↓ Prisma queries only
Prisma Client (lib/prisma.ts) → PostgreSQL
```

Server Components under `app/(protected)/` read directly rather than round-tripping through the API routes — through a **service** when the data needs rules or DTO conversion (e.g. `PurchaseOrderService.getById` on the order page), or straight from a repository for a plain lookup (the protected layout's `UserRepository.findById`, the supplier list on the order and master-data pages). API routes exist for what the browser calls: auth, and every mutation (create, edit, submit, approve, send). Client Components receive plain data only — see "Server → Client boundary" below.

## Request flow & auth

1. **`middleware.ts`** runs on every request (matcher excludes static assets). It is the single point where authentication is enforced:
   - Public paths (`/login`, `/api/auth/login`) pass through. `/api/auth/register` is not public — it lets the caller choose a role, so it is ADMIN-only.
   - All other paths require a valid `kitchen-token` JWT cookie (HS256, 8h expiry, signed with `JWT_SECRET`, verified via `jose`). Missing/invalid tokens redirect to `/login`.
   - `ROLE_GUARDS` maps path prefixes to allowed `Role`s. **Every** matching prefix is checked, so overlapping guards are AND-ed: `/procurement` sets the baseline and narrower prefixes (`/procurement/orders`, `/procurement/approvals`, `/procurement/receiving`, and the matching `/api/*` prefixes) restrict further. A guard may name `methods`, applying only to those: the item-master and BOM APIs are guarded for writes (`POST`/`PUT`/`PATCH`/`DELETE`) while reads stay open to every signed-in user. A mismatch redirects to `/unauthorized`. The sidebar (`lib/navigation.ts`) mirrors these but only hides links; middleware is what blocks the URL.
   - On success, middleware injects `x-user-id`, `x-user-role`, `x-user-email` onto the forwarded request. Route handlers trust these headers instead of re-verifying the JWT — which is only safe on paths middleware guards.
   - Middleware runs in the **Edge runtime**, so everything it imports must be Edge-safe: it imports `lib/jwt.ts` (`jose` only), never `lib/auth.ts` (bcrypt) or Prisma. `next dev` tolerates a violation; only `next build && next start` exposes it.
2. **Server Components** call `getSession()` (`lib/session.ts`), which re-verifies the cookie. The protected layout also re-fetches the user, which catches users deleted after the token was issued.
3. **Login/Register/Logout** go through `AuthService`, which hashes/verifies passwords with bcrypt (12 rounds, with a dummy-hash comparison to avoid user-enumeration timing) and issues/clears the `kitchen-token` cookie (httpOnly, `secure` in production, `sameSite=lax`).

## Authorization: path vs action

A path guard can say who may reach a URL, not what they may do there. Where one path serves several roles doing different things, the service checks the role for the action:

- Accounting must reach `/api/purchase-orders` to approve, but must not edit a draft — `PurchaseOrderService.updateDraft` refuses non-procurement roles.
- Accounting reads `/procurement/receiving` to approve reports, but `/procurement/receiving/new` has its own procurement-only guard, and the edit page (`[id]/edit`, which no prefix can match) redirects other roles itself.
- All approve/reject decisions go through **one** endpoint, `POST /api/approvals` (guarded to ADMIN + ACCOUNTING), which dispatches on `referenceType`. Every other transition has its own endpoint (`.../submit`, `.../send`).
- **Nobody approves their own work, ADMIN included.** The approver is compared with the person responsible (PR: requester; PO: `submittedById`; RR: `receivedById`, who is whoever last saved the draft — submitting does not change it).

## Layers in detail

- **Route handlers** (`app/api/**/route.ts`): parse/validate bodies with `zod`, read the injected identity headers (401 if absent), delegate to a service, and translate the result into an HTTP response. They never import Prisma.
- **Services** (`services/`): business rules and orchestration across repositories. They return a typed result union — `{ success: true, data } | { success: false, error, status }` — rather than throwing, and they convert Prisma rows into DTOs (Decimals as strings) for the UI.
- **Repositories** (`repositories/`): the only layer allowed to import `lib/prisma`. Each is scoped to one model/domain concept, defines its `select`/`include` shapes (e.g. `safeUserSelect` excludes `passwordHash`), and owns transactions (`prisma.$transaction`) when a write spans several tables.
- **`lib/`**: `prisma.ts` (client singleton reused across hot reloads), `config.ts` (fails fast on missing env vars), `jwt.ts` (Edge-safe JWT), `auth.ts` (Node-only, adds bcrypt), `session.ts`, `navigation.ts`, `queue.ts` (BullMQ producer, Node-only), `decimal.ts` (Decimal ↔ string, server-only), `format.ts` (display formatting usable on both sides), `dates.ts` (business-day helpers in Asia/Manila).
- **`worker/`**: the BullMQ consumer (see Infrastructure).
- **`components/`**: shared UI. Reusable procurement pieces: `StatusBadge`, `DecisionHistory`, `ApprovalActions`, `PurchaseRequestActions`, `PurchaseOrderActions`; form primitives in `components/ui/form.tsx`.

This is a conventional layered/n-tier architecture rather than DDD or hexagonal — repositories wrap Prisma calls fairly directly, and business rules live in services as plain objects of async functions.

## Patterns in use

- **Race-safe status transitions.** The expected current status goes in the UPDATE's `WHERE` (`updateMany({ where: { id, status: DRAFT } })`), and a zero-row result means someone else moved it first → 409. No read-then-write gap.
- **Row locks for cumulative checks.** When a write depends on a total other transactions also change — RR approval checks accepted ≤ ordered per PO line — lock the parent row first (`SELECT … FOR UPDATE` via `$queryRaw`, e.g. `PurchaseOrderRepository.lockForReceiving`), then read the total inside the same transaction. A second approval on the same order waits, then sees the first's committed rows. Take locks in one order (order before report) so two transactions cannot deadlock. To abort with a reason from inside `$transaction`, throw a small error class and map it to a result outside (`ReceivingConflict` in `receiving-report.repository.ts`).
- **Stock writes** go through `InventoryRepository.stockIn(tx, …)`: ledger row and level change together, on the caller's transaction.
- **Document numbers** come from Postgres sequences (`pr_number_seq`, `po_number_seq`, `rr_number_seq`) via `nextval()` inside the creating transaction, formatted `PR-000001` etc. `count() + 1` is not used — it issues duplicates under concurrency.
- **Server → Client boundary.** Prisma `Decimal` is a class instance and cannot cross into a Client Component; services stringify it with `toDecimalString` (`lib/decimal.ts`). Client code formats strings with `lib/format.ts` and may import service *types* only (`import type`), never values.
- **Next.js 15**: `params` and `searchParams` are Promises and must be awaited. `notFound()` renders the nearest `not-found.tsx`.
- **Queue failures never fail the user's action.** A request is submitted even if Redis is down; the enqueue is wrapped in try/catch after the status change commits.

## Data model

Defined in `prisma/schema.prisma` (24 models, PostgreSQL). Domain areas:

- **Identity**: `User` (role via `Role`: `ADMIN`, `PROCUREMENT_MANAGER`, `PRODUCTION_MANAGER`, `BRANCH_MANAGER`, `ACCOUNTING`, `VIEWER`), `Branch`.
- **Item master**: `Category`, `Unit`, `Material`, `FinishedGood`, and `ItemPrice` (dated reference prices per material, optionally per supplier).
- **BOM**: `BOM` (versioned per finished good, stated per batch of `batchSize`) and `BOMItem` lines pointing at `Material`.
- **Procurement**: `Supplier`; `PurchaseRequest`/`PurchaseRequestItem` → `PurchaseOrder`/`PurchaseOrderItem` → `ReceivingReport`/`ReceivingReportItem`. Each stage has its own status enum (`PRStatus`, `POStatus`, `RRStatus`). An RR line links to its PO line; an RR records the branch it was received at and who counted it.
- **Inventory**: `InventoryLevel` (current on-hand per material per branch) and `StockMovement` (append-only ledger, per material per branch, typed by `MovementType`, referencing its source document).
- **Production**: `ProductionOrder`, `Conversion` (not yet built).
- **Distribution**: `StockTransfer`/`StockTransferItem` (not yet built).
- **Approvals**: `Approval` is polymorphic (`referenceType` + `referenceId`), one row per decision on a PR, PO or RR.
- **Notifications**: `Notification` rows per user, unread while `readAt` is null.

See [database.md](database.md) for relationships, indexes and migration rules.

## Infrastructure

- **PostgreSQL 16** and **Redis 7** run via `docker-compose.yml` for local development (health-checked, persisted to named volumes).
- **BullMQ**: `lib/queue.ts` is the producer (lazy `Queue` on `globalThis`, so importing it opens no connection — `next build` must not need Redis). `worker/index.ts` is the consumer, run as a **separate process** with `npm run worker` (watch) or `npm run worker:start`. A `Worker` inside the Next.js process would be duplicated on every hot reload, so nothing under `app/` imports `worker/`. The worker is thin and delegates to services (`NotificationService`). Current job: `pr-submitted` → notification rows for approvers minus the requester.
- **PDF**: `GET /api/purchase-orders/[id]/pdf` renders with `@react-pdf/renderer` in the request (Node runtime). Money prints as `PHP 1,420.00` — the built-in PDF fonts have no `₱`.
- **Environment config** is centralized in `lib/config.ts`, which throws at import if `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` or `NEXT_PUBLIC_APP_URL` is missing. The worker loads `.env` itself via `tsx --env-file=.env`.
- No cache, file storage, or deploy target yet — see [deployment.md](deployment.md).

## Conventions to follow when extending this

- New features follow route handler → service → repository; never call `prisma` from a route handler, page or service.
- Keep secret-bearing fields out of repository return types — follow `safeUserSelect` / `SafeUser`.
- Route-level access belongs in `middleware.ts` `ROLE_GUARDS`. A service-level role check is for an *action* the path cannot distinguish (see "Authorization: path vs action"), not a substitute for a guard.
- Anything `middleware.ts` imports must stay Edge-safe; `lib/queue.ts` and `lib/auth.ts` are Node-only.
