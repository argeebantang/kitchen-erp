# 2026-10-30 — Close three API gaps found while writing api.md

Reading every route handler for `docs/api.md` turned up three problems. All three predate
Week 4. No database changes.

## 1. Anyone could create an ADMIN account

**What:** `/api/auth/register` was in `PUBLIC_PATHS`, and its schema accepts any `role`. An
unauthenticated `POST` with `"role": "ADMIN"` created an admin who could then log in. No page
calls the endpoint (it dates from the Week 1 auth rebuild, `df3ad90`), which is why it went
unnoticed — but an endpoint needs no page to be called.

**Fix:** removed from `PUBLIC_PATHS`; new guard `/api/auth/register` → `ADMIN`. Signed out → 307
to `/login`; any other role → 307 to `/unauthorized`.

**Why guard, not delete:** the planned `/admin/users` page needs a create-user endpoint, and this
one is already validated (zod, bcrypt via `AuthService`, duplicate email → 409).

## 2. Item-master and BOM writes had no role guard

**What:** `/api/materials` (incl. `/[id]/prices`), `/api/finished-goods`, `/api/categories`,
`/api/units` and `/api/boms` sat behind sign-in only. A `VIEWER` could create or deactivate
materials, record prices (which price new PRs and POs), and publish BOM versions. The pages using
them (`/admin/master`, `/production/bom`) were guarded; the APIs were not.

**Fix:** `ROLE_GUARDS` entries gain an optional `methods` list, and the loop skips a guard whose
`methods` excludes the request's method. New write-only guards (`WRITE_METHODS` = POST, PUT,
PATCH, DELETE):

| Prefix | Write roles |
|---|---|
| `/api/materials`, `/api/finished-goods`, `/api/categories`, `/api/units` | ADMIN |
| `/api/boms` | ADMIN, PRODUCTION_MANAGER |

Reads stay open to every signed-in user — the item master is read across modules.

| Option | Why not |
|---|---|
| Path guard on all methods | Would also block reads for every non-admin role. |
| Role checks in each service | Eight handlers and services to thread a viewer through, and route access is meant to live in `middleware.ts` (`docs/coding-conventions.md`). |

**Roles chosen from the UI that exists:** every item-master write comes from `/admin/master`
(ADMIN only). `POST /api/boms` has no caller yet; BOMs belong to production, so it gets the
`/production` roles. If procurement should record supplier prices, widen
`/api/materials` writes then.

## 3. `?includeInactive=false` meant true

**What:** `includeInactive` (materials, finished goods) and `includeSuperseded` (BOMs) used
`z.coerce.boolean()`, which is `Boolean(value)` — any non-empty string, `"false"` included, is
`true`. No page sends `false`, so nothing visible was wrong yet.

**Fix:** `z.enum(['true', 'false']).transform(value => value === 'true').optional()` in the three
list schemas. Anything other than `true`/`false` is now a 400.

## Files affected

`middleware.ts`, `app/api/materials/route.ts`, `app/api/finished-goods/route.ts`,
`app/api/boms/route.ts`, `docs/api.md`, `docs/architecture.md`, `docs/progress.md`, this note.

## How to verify

Run against `npm run dev`, logged in per role (seeded logins, `password123`):

- `POST /api/auth/register` signed out → 307 `/login`; as viewer or accounting → 307
  `/unauthorized`; as admin with `{}` → 400 (reached the handler).
- `POST /api/materials`, `/api/finished-goods`, `/api/categories`, `/api/units`, `/api/boms`
  as viewer or procurement → 307 `/unauthorized`; as admin with `{}` → 400. `POST /api/boms` as
  production → 400; `POST /api/materials` as production → 307.
- `PATCH`/`DELETE /api/materials/[id]` and `POST /api/materials/[id]/prices` as viewer → 307.
- Every `GET` above as viewer → 200.
- `/admin/master` as admin: add, edit and deactivate a material, record a price — all still work.
- `GET /api/materials?includeInactive=yes` → 400.

## Risks / follow-up

- A guarded API answers a disallowed call with a 307 to `/unauthorized`, not a 403 — the same as
  every existing API guard. `fetch` follows the redirect, so a client gets the
  `/unauthorized` page's HTML instead of a JSON error. Worth changing for all `/api` paths at once (return 401/403 JSON from middleware), not here.
- The register endpoint still lets an ADMIN create another ADMIN. That is intended.
