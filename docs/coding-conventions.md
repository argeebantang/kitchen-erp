# Coding Conventions

## General

* Follow existing project style.
* Prefer readability over clever code.
* Keep functions focused on a single responsibility.
* Avoid deeply nested conditionals — use early returns (see `middleware.ts`, `lib/auth.ts`).
* Remove dead code.
* Do not introduce unnecessary abstractions.
* Respect the layered architecture: route handler → service → repository → Prisma. Route handlers and pages never import `lib/prisma` directly; only repositories do. See [architecture.md](architecture.md) for the full rationale.
* TypeScript `strict` mode is on (`tsconfig.json`) — don't weaken it with `any` or non-null assertions (`value!`) to silence errors; handle the missing case explicitly (return an error result) or fix the underlying type.
* Comments explain *why* — a rule, a trap, a decision — not what the next line does. Link the change note or doc that settled it when there is one.

## Naming

* Use descriptive names. Follow existing naming conventions.
* Avoid abbreviations unless already standard (e.g. `req`/`res`, `PR`/`PO`/`RR`); don't invent new ones.
* **Files**: layer-suffixed, lowercase kebab/dot-case — `*.service.ts` (`purchase-order.service.ts`), `*.repository.ts` (`receiving-report.repository.ts`). React components are `PascalCase.tsx` (`ReceivingReportForm.tsx`).
* **Exported service/repository objects**: PascalCase noun matching the file, e.g. `PurchaseOrderService`, `ReceivingReportRepository` — implemented as plain objects of async functions, not classes.
* **Functions/variables**: camelCase (`verifyToken`, `buildAuthCookie`, `passwordHash`).
* **Types**: PascalCase, named for what they represent at their layer —
  * `*Input` for data going into a service or repository (`LoginInput`, `CreateReceivingReportInput`)
  * `*Dto` for what a service hands to pages and Client Components (`PurchaseOrderDetailDto`) — strings instead of Decimals
  * `Safe*` for repository shapes with sensitive fields stripped (`SafeUser`)
  * `*Result` for discriminated-union outcomes (`AuthResult`, `ReceivingReportResult<T>`)
  * `*With*` / `*Summary` for repository `include` shapes (`ReceivingReportWithDetail`)
* **Constants**: SCREAMING_SNAKE_CASE for fixed configuration values (`BCRYPT_ROUNDS`, `JWT_EXPIRY`, `RECEIVABLE_STATUSES`).
* **Prisma models/enums**: PascalCase singular (`User`, `PurchaseOrder`, `Role`), matching existing `schema.prisma` style.

## Error Handling

* Handle expected failures explicitly and return meaningful error messages. Services return `{ success: true, data } | { success: false, error, status }` rather than throwing; the route handler maps `status` to the HTTP response.
* Status codes in use: 400 invalid input or a broken business rule on the input · 401 no identity headers · 403 role or ownership (incl. self-approval) · 404 not found · 409 wrong state (not a draft, already decided, changed by someone else).
* Validate all external input with `zod` at the route-handler boundary before it reaches a service. On failure, return `400` with `parsed.error.flatten().fieldErrors`, never a raw error object. Quantities arrive as decimal **strings** (validated by regex) and are parsed into `Prisma.Decimal` in the service.
* Wrap route handler bodies in `try/catch`; on an unexpected exception, `console.error` with a `[METHOD /path]` prefix and return a generic `500 Internal server error` — don't leak internal error details to the client.
* Reserve thrown exceptions for truly unexpected failures that the route handler's `catch` will handle.
* Client-side checks in forms are for the person typing; the service re-checks everything. Never rely on a disabled button or a hidden link as the rule.
* Fail fast on missing configuration — see `lib/config.ts`'s `requireEnv`.
* A background-job failure (Redis down, enqueue error) never fails the user's action: enqueue after the main write commits, inside its own `try/catch`.

## Concurrency

* State transitions put the expected status in the UPDATE's `WHERE` (`updateMany({ where: { id, status } })`) and treat a zero count as 409. Don't read the status, check it in JS, then write.
* Writes that span several tables run in one `prisma.$transaction(async tx => …)`, and every query inside uses `tx`, not `prisma`.
* Document numbers come from a Postgres sequence via `nextval()`, never `count() + 1`.

## Server / Client boundary

* Never pass a Prisma `Decimal` (or any class instance) to a Client Component. Convert with `toDecimalString` (`lib/decimal.ts`) in the service.
* Client Components may `import type` from services (DTO types) but never import a value from `services/`, `repositories/` or `lib/decimal.ts` — that pulls Prisma into the browser bundle.
* Formatting both sides need (`trimDecimal`, `formatPeso`) lives in `lib/format.ts`, which has no `'use client'` and no Prisma import.
* Float arithmetic in the browser (e.g. a live "accepted" figure) is compared in integer millionths to avoid `10.3 - 0.1` errors; the server's Decimal check is the one that holds.
* Anything `middleware.ts` imports must be Edge-safe (`lib/jwt.ts`, not `lib/auth.ts`). `lib/queue.ts` is Node-only. Nothing under `app/` imports `worker/`.

## Performance

* Avoid N+1 queries — use Prisma `include`/`select` to fetch related data in one query rather than looping and querying per row.
* Paginate every list that can grow unbounded: repository `findMany` takes `skip`/`take` (default 50) and returns `{ rows, total }`.
* Batch writes with nested `create`, `createMany` or one `$transaction` instead of per-row round trips where the rows are independent.
* Let the database filter and aggregate (`where`, `groupBy`, `_sum`) rather than looping in Node.
* Cache only when justified by a measured cost — Redis is used for the queue, nothing is cached; don't add caching speculatively.

## Security

* Validate all input at the boundary with `zod` — never trust `req.json()`/`req.headers` unvalidated.
* `x-user-id`/`x-user-role`/`x-user-email` are only trustworthy because `middleware.ts` sets them after verifying the JWT — do not read them in a code path middleware doesn't guard. Who did something (`requestedById`, `submittedById`, `receivedById`, `approverId`) always comes from these headers, never from the request body.
* Route access goes in `middleware.ts` `ROLE_GUARDS`. A role check in a service is only for an action the path cannot distinguish (e.g. accounting may reach `/api/purchase-orders` to approve but may not edit a draft) — not a substitute for a guard.
* Nobody approves their own work, ADMIN included — compare the approver with the submitter/counter in the service.
* Repositories select only safe fields for anything that leaves the data layer — follow `safeUserSelect`/`SafeUser` so secrets (`passwordHash`, tokens) never reach a service or response by accident.
* Hash passwords with `bcrypt` via `lib/auth.ts` helpers; compare with `verifyPassword`, which runs against a dummy hash when the user doesn't exist to avoid timing-based user enumeration.
* Auth cookies are `httpOnly`, `sameSite=lax`, and `secure` in production (see `buildAuthCookie`).
* React escapes output by default — avoid `dangerouslySetInnerHTML` unless unavoidable and the input is trusted/sanitized.

## UI

* Light theme only. Pages fill the content area — no `max-w-*` page wrappers.
* Reuse `components/ui/form.tsx` (`Field`, `inputClass`, button classes), `StatusBadge`, `DecisionHistory`, `ApprovalActions` before writing new ones.
* Money on screen uses `formatPeso` (`₱`); in PDFs it prints as `PHP 1,420.00`.

## Refactoring

* Keep refactoring separate from feature work whenever possible — submit them as distinct changes.
* Avoid changing unrelated files.
* When a pattern needs to change (e.g. the auth-cookie shape, the safe-select approach), update it at its single source of truth (e.g. `buildAuthCookie`, `safeUserSelect`) rather than duplicating the change at each call site.
