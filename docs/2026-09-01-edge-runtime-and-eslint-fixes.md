# 2026-09-01 — Fix Edge-runtime middleware crash and a lint config that never ran

Two pre-existing bugs, both found while verifying Week 2 against a production build, and both
invisible under `next dev`. Neither is related to Week 2 feature work, so they are recorded
separately.

## 1. Middleware crashed in the Edge runtime — every protected route 500'd in production

### Symptom

`npm run build && npm start`, then request any protected route:

```
EvalError: Code generation from strings disallowed for this context
    at (middleware)/./node_modules/next/dist/build/webpack/loaders/next-middleware-loader.js...
```

Every page behind `middleware.ts` returned **500**. `next dev` was completely unaffected, which is
why it had gone unnoticed since `f833210`.

### Cause

`middleware.ts` imported `verifyToken` and `COOKIE_NAME` from `lib/auth.ts`. That module *also*
imports **bcryptjs** for password hashing. Middleware runs in the **Edge runtime**, which forbids
code generation from strings — and bcryptjs relies on exactly that. Importing one function pulled
the whole module graph, bcrypt included, into the Edge bundle.

`middleware.ts` also did a value import of `Role` from `@prisma/client`, which risks dragging the
Prisma client in the same way.

### Fix

Split the auth module by runtime:

- **`lib/jwt.ts` (new)** — Edge-safe. `jose` only: `signToken`, `verifyToken`, `COOKIE_NAME`,
  `JWTPayload`. Must stay free of bcrypt, Prisma, and anything Node-only.
- **`lib/auth.ts`** — Node-only. Keeps `hashPassword`/`verifyPassword` (bcrypt), and re-exports the
  JWT helpers so server-side callers can still import everything auth-related from one place.
- **`middleware.ts`** — imports from `@/lib/jwt`, and `Role` becomes `import type`, which is erased
  at compile time so the Prisma client cannot enter the Edge bundle either.

The middleware bundle dropped from **49.1 kB to 39 kB**, confirming bcrypt is gone.

No behaviour changed: the same JWT is verified with the same secret, and `ROLE_GUARDS` is
untouched. Verified after the fix that a VIEWER still gets `307 → /unauthorized` on `/admin/master`
and `/production/bom`, and that a request with no cookie still gets `307 → /login`.

### Lesson

Anything imported by `middleware.ts` — however indirectly — must be Edge-compatible. Prefer
`import type` for types, and keep Node-only dependencies out of modules that middleware touches.
**A green `next dev` proves nothing about Edge compatibility; only `next build && next start` does.**

## 2. `npm run lint` had never worked

### Symptom

```
Cannot find module '/home/argee/kitchen-erp/node_modules/eslint-config-next/core-web-vitals'
imported from /home/argee/kitchen-erp/eslint.config.mjs
```

The Lint step in `.github/workflows/ci.yml` was failing on every run, since the initial commit
(`9dcea26`) — `eslint.config.mjs` had never been modified.

### Cause

Version mismatch. `eslint.config.mjs` was generated for a newer `eslint-config-next` that ships
native flat configs, but the project pins **15.3.4**, which still ships legacy eslintrc-style
configs (`module.exports = { extends: [...] }`) and has **no package `exports` map**.

Adding a `.js` extension would not have been enough: the module exports an *object*, and a flat
config spreads *arrays*. The shape is wrong, not just the path.

### Fix

Rewrote `eslint.config.mjs` to use the `FlatCompat` bridge — what `create-next-app` generates for
this Next version — and added **`@eslint/eslintrc`** as an explicit devDependency (it had been
present only transitively, which `npm ci` hoisting could change at any time).

Also set `eslint.dirs` in `next.config.ts`. `next lint` defaults to `app`, `pages`, `components`,
`lib` and `src` only — silently skipping `repositories/` and `services/`, where most of this
project's logic lives per `docs/architecture.md`. With those included, lint immediately found one
real issue: an unused `NextResponse` import in `services/auth.service.ts`, now removed.

## Files affected

| File | Change |
|---|---|
| `lib/jwt.ts` | **New** — Edge-safe JWT helpers |
| `lib/auth.ts` | bcrypt-only; re-exports JWT helpers |
| `middleware.ts` | Imports from `lib/jwt`; `Role` is now `import type` |
| `eslint.config.mjs` | Rewritten to use `FlatCompat` |
| `next.config.ts` | Added `eslint.dirs` |
| `services/auth.service.ts` | Removed unused `NextResponse` import |
| `package.json` | Added `@eslint/eslintrc` devDependency |

## Database / API / UI changes

None. No schema, endpoint, or rendered output changed.

## How to verify

```bash
npm run lint          # expect: ✔ No ESLint warnings or errors
npx tsc --noEmit      # expect: no output

# The bug that dev mode hides — this is the part that matters:
npm run build && npm start
# then log in and load /dashboard, /admin/master, /production/bom — all 200, not 500
```

Confirm the Edge bundle stayed small: the build summary should show `ƒ Middleware ~39 kB`. If it
jumps back toward 49 kB, something Node-only has been reintroduced into the middleware graph.

## Risks, assumptions, follow-up

- **Low risk.** The auth split is a pure module reorganisation; signing and verification logic is
  byte-for-byte unchanged, and role guards were re-verified end to end.
- **Assumption:** nothing else imports `lib/auth.ts` from an Edge context. Only `middleware.ts`
  runs on Edge today, and it now imports `lib/jwt.ts`.
- **Follow-up:** upgrade `eslint-config-next` to 15.5+, then drop `FlatCompat` and import
  `eslint-config-next/core-web-vitals` directly.
- **Follow-up:** consider adding `npm run build` to CI. Both bugs here were production-only, and
  CI currently runs typecheck, lint and `prisma validate` but never actually builds.
