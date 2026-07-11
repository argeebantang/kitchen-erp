# Architecture

## Overview

KitchenERP is a single Next.js 15 application (App Router) that serves both the UI and the API from one deployable unit — there is no separate backend service today. Server code is organized into three layers so that HTTP concerns, business rules, and data access stay separate:

```
Route Handler (app/api/**/route.ts)
        ↓ validates input (zod), maps result → HTTP
Service (services/*.service.ts)
        ↓ business rules, orchestration
Repository (repositories/*.repository.ts)
        ↓ Prisma queries only
Prisma Client (lib/prisma.ts) → PostgreSQL
```

Server Components under `app/(protected)/` call repositories/services directly for reads (e.g. `app/(protected)/layout.tsx` calls `UserRepository.findById`), rather than round-tripping through the API routes. API routes exist for actions the client needs to call (login, logout, register) and for future client-side data mutations.

## Request flow & auth

1. **`middleware.ts`** runs on every request (matcher excludes static assets). It is the single point where auth is enforced:
   - Public paths (`/login`, `/api/auth/login`, `/api/auth/register`) pass through.
   - All other paths require a valid `kitchen-token` JWT cookie (HS256, 8h expiry, signed with `JWT_SECRET`, verified via `jose`). Missing/invalid tokens redirect to `/login`.
   - `ROLE_GUARDS` in the same file maps path prefixes (`/dashboard/procurement`, `/dashboard/production`, `/dashboard/branches`) to allowed `Role`s; a mismatch redirects to `/unauthorized`.
   - On success, middleware injects `x-user-id`, `x-user-role`, `x-user-email` headers onto the forwarded request, so downstream route handlers (e.g. `app/api/auth/me/route.ts`) trust these headers instead of re-verifying the JWT.
2. **Server Components** (e.g. the protected layout) don't see those injected headers directly — they call `getSession()` (`lib/session.ts`), which re-reads and re-verifies the cookie via `verifyToken`, then re-fetch the user from the DB. This is intentional: it also catches users deleted after the token was issued.
3. **Login/Register/Logout** go through `AuthService` (`services/auth.service.ts`), which hashes/verifies passwords with bcrypt (12 rounds, constant-time-ish via a dummy hash comparison to avoid user-enumeration timing attacks) and issues/clears the `kitchen-token` cookie (httpOnly, `secure` in production, `sameSite=lax`).

## Layers in detail

- **Route handlers** (`app/api/**/route.ts`): parse/validate request bodies with `zod`, delegate to a service, translate the service result into an HTTP response. They do not talk to Prisma directly.
- **Services** (`services/`): hold business logic and orchestrate one or more repositories (e.g. `AuthService.login` combines `UserRepository` lookup + password verification + JWT signing). Services return plain result objects (e.g. `AuthResult` discriminated union) rather than throwing/formatting HTTP — that stays in the route handler.
- **Repositories** (`repositories/`): the only layer allowed to import `lib/prisma`. Each repository is scoped to one Prisma model/domain concept (e.g. `UserRepository`) and defines safe projections (e.g. `safeUserSelect` excludes `passwordHash`) so secrets never leak past this layer.
- **`lib/`**: cross-cutting singletons and helpers — `prisma.ts` (Prisma client singleton, reused across hot-reloads in dev), `config.ts` (fails fast on missing required env vars), `auth.ts` (JWT sign/verify, password hashing), `session.ts` (server-only cookie → session helper), `navigation.ts` (sidebar/nav config).
- **`hooks/`**: client-side React hooks, e.g. `useUser.ts` for consuming the current session in client components.
- **`components/`**: shared UI, currently `components/dashboard/Sidebar.tsx`, rendered from the protected layout with the current user's name/role.

This is a conventional layered/n-tier architecture rather than DDD or hexagonal — there are no domain entities or ports/adapters abstractions; repositories wrap Prisma calls fairly directly, and business rules live in services as procedural functions.

## Data model

Defined in `prisma/schema.prisma` (22 models, PostgreSQL). Domain areas:

- **Identity**: `User` (role-based via `Role` enum: `ADMIN`, `PROCUREMENT_MANAGER`, `PRODUCTION_MANAGER`, `BRANCH_MANAGER`, `VIEWER`), `Branch`.
- **Item master**: `Category`, `Unit`, `Material` (raw/purchased items), `FinishedGood` (produced items).
- **BOM**: `BOM` and `BOMItem` — a `FinishedGood` has one or more `BOM`s, each with `BOMItem` lines pointing at `Material` + quantity + `Unit`.
- **Procurement**: `Supplier` → `PurchaseRequest`/`PurchaseRequestItem` → `PurchaseOrder`/`PurchaseOrderItem` → `ReceivingReport`/`ReceivingReportItem`. Each stage has its own status enum (`PRStatus`, `POStatus`, `RRStatus`) and a PR can fan out to multiple POs.
- **Inventory**: `InventoryLevel` (current on-hand quantity per `Material` per `Branch`) and `StockMovement` (append-only ledger of changes, typed by `MovementType`) are the two inventory-tracking primitives — one holds current state, the other holds history.
- **Production**: `ProductionOrder` (references a `FinishedGood`, its `BOM`, a `Branch`, and the requesting `User`; tracked via `ProductionStatus`), `Conversion` (turns one `FinishedGood` into another, with distinct `ConversionSource`/`ConversionOutput` relations).
- **Distribution**: `StockTransfer`/`StockTransferItem` move `Material` between branches (`TransferFrom`/`TransferTo` relations on `Branch`).
- **Approvals**: `Approval` links a `User` (approver) to a `PurchaseRequest`; this is currently procurement-specific rather than a generic polymorphic approval on every workflow.

## Infrastructure

- **PostgreSQL 16** and **Redis 7** run via `docker-compose.yml` for local development (health-checked, persisted to named volumes).
- **Redis** is provisioned (`ioredis`, `REDIS_URL` required in `lib/config.ts`) and **BullMQ** is a dependency, but no queues/workers are implemented in the codebase yet — this is provisioned ahead of the background-job work (notifications, low-stock checks) described in the project roadmap.
- **Environment config** is centralized in `lib/config.ts`, which throws at startup if a required variable (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `NEXT_PUBLIC_APP_URL`) is missing, rather than failing later with an unclear error.
- No caching layer, file storage, or external deploy target is wired up yet.

## Conventions to follow when extending this

- New domain features should follow the same route handler → service → repository shape already established by the auth module; don't call `prisma` from a route handler or a service directly.
- Keep secret-bearing fields (password hashes, tokens) out of repository return types used by services/UI — follow the `safeUserSelect` / `SafeUser` pattern.
- Route-level access control belongs in `middleware.ts` (`ROLE_GUARDS`), not scattered per-page checks; page-level `getSession()` calls are for fetching the current user, not for re-implementing authorization.
