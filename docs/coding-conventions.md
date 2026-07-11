# Coding Conventions

## General

* Follow existing project style.
* Prefer readability over clever code.
* Keep functions focused on a single responsibility.
* Avoid deeply nested conditionals — use early returns (see `middleware.ts`, `lib/auth.ts`).
* Remove dead code.
* Do not introduce unnecessary abstractions.
* Respect the layered architecture: route handler → service → repository → Prisma. Route handlers never import `lib/prisma` directly; only repositories do. See [architecture.md](architecture.md) for the full rationale.
* TypeScript `strict` mode is on (`tsconfig.json`) — don't weaken it with `any` or non-null assertions to silence errors; fix the underlying type instead.

## Naming

* Use descriptive names. Follow existing naming conventions.
* Avoid abbreviations unless already standard (e.g. `req`/`res` for Express-style handlers is fine; don't invent new ones).
* **Files**: layer-suffixed, lowercase-dot-case — `*.service.ts` (`auth.service.ts`), `*.repository.ts` (`user.repository.ts`). React components are `PascalCase.tsx` (`Sidebar.tsx`).
* **Exported service/repository objects**: PascalCase noun matching the file, e.g. `AuthService`, `UserRepository` — implemented as plain objects of async functions, not classes.
* **Functions/variables**: camelCase (`verifyToken`, `buildAuthCookie`, `passwordHash`).
* **Types**: PascalCase, named for what they represent at their layer — `*Input` for data going into a service (`LoginInput`, `CreateUserInput`), `Safe*` for repository return shapes with sensitive fields stripped (`SafeUser`), `*Result` for discriminated-union outcomes (`AuthResult`).
* **Constants**: SCREAMING_SNAKE_CASE for fixed configuration values (`BCRYPT_ROUNDS`, `JWT_ALGORITHM`, `JWT_EXPIRY`, `COOKIE_NAME`).
* **Prisma models/enums**: PascalCase singular (`User`, `PurchaseOrder`, `Role`), matching existing `schema.prisma` style — keep new models consistent.

## Error Handling

* Handle expected failures explicitly and return meaningful error messages — see `AuthService.login`/`register` returning a typed `{ success: false, error, status }` rather than throwing.
* Validate all external input with `zod` at the route-handler boundary (see `LoginSchema`, `RegisterSchema`) before it reaches a service. On failure, return `400` with the validation detail (`parsed.error.flatten().fieldErrors`), never a raw error object.
* Wrap route handler bodies in `try/catch`; on an unexpected exception, `console.error` with a `[METHOD /path]` prefix and return a generic `500 Internal server error` — don't leak internal error details to the client.
* Services return typed result objects (success/error unions) for expected failure paths (invalid credentials, duplicate email); reserve thrown exceptions for truly unexpected/unrecoverable failures that the route handler's `catch` block will handle.
* Fail fast on missing configuration — see `lib/config.ts`'s `requireEnv`, which throws at startup rather than surfacing a confusing runtime error later.

## Performance

* Avoid N+1 queries — use Prisma `include`/`select` to fetch related data in one query rather than looping and querying per row.
* Use pagination for any endpoint/list that can grow unbounded (e.g. purchase orders, stock movements) — none of the current list-style queries exist yet, so establish pagination when adding the first one rather than retrofitting later.
* Batch large writes (e.g. bulk BOM item inserts, receiving report lines) with Prisma's batch APIs (`createMany`, `$transaction`) instead of per-row awaits in a loop.
* Avoid unnecessary loops over data Prisma can already filter/aggregate at the DB level.
* Cache only when justified by a measured cost — Redis is provisioned but nothing is cached yet; don't add caching speculatively.

## Security

* Validate all input at the boundary with `zod` — never trust `req.json()`/`req.headers` unvalidated.
* Never trust client input, including headers: `x-user-id`/`x-user-role`/`x-user-email` are only trustworthy because `middleware.ts` sets them after verifying the JWT — do not read them in a code path that middleware doesn't already guard.
* Apply authorization checks consistently via `middleware.ts` `ROLE_GUARDS`; don't add ad hoc role checks inside individual pages/handlers as a substitute.
* Repositories must select only safe fields for anything that leaves the data layer — follow the `safeUserSelect`/`SafeUser` pattern so secrets (`passwordHash`, tokens) never reach a service or response by accident.
* Hash passwords with `bcrypt` via `lib/auth.ts` helpers (never a custom hash); compare with `verifyPassword`, which runs against a dummy hash when the user doesn't exist to avoid timing-based user enumeration — preserve this pattern in any new credential-comparison code.
* Auth cookies are `httpOnly`, `sameSite=lax`, and `secure` in production (see `buildAuthCookie`) — keep new cookies consistent with this configuration unless there's a specific reason to diverge.
* Escape/encode output where required (React escapes by default — avoid `dangerouslySetInnerHTML` unless unavoidable and the input is trusted/sanitized).

## Refactoring

* Keep refactoring separate from feature work whenever possible — submit them as distinct changes.
* Avoid changing unrelated files.
* When a pattern needs to change (e.g. the auth-cookie shape, the safe-select approach), update it at its single source of truth (e.g. `buildAuthCookie`, `safeUserSelect`) rather than duplicating the change at each call site.
