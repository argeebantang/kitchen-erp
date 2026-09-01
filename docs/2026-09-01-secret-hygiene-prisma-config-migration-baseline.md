# 2026-09-01 — Remove committed JWT, drop dead prisma.config.ts, baseline migrations

Three pre-Week-2 cleanups. The first is a secret-hygiene issue, the second unblocks CI, and
the third establishes migration history before the Week 2 schema change (`item_prices`) lands.

## 1. Removed `cookies.txt` from the repository

### What changed

- Deleted `cookies.txt` from the working tree and from git tracking (`git rm --cached`).
- Added `cookies.txt` and `*.cookies` to `.gitignore`.

### Why

The file was a curl cookie jar committed in `df3ad90` ("feat: auth rebuild"). It contained a
real HS256-signed `kitchen-token` for `admin@kitchen.com` with the `ADMIN` role. A signed
production-shaped credential does not belong in version control regardless of its expiry.

### History assessment — no rewrite performed

The committed token was evaluated rather than assumed dangerous:

| Factor | Finding |
|---|---|
| Token expiry | `exp = 1783170313` → **2026-07-04**, expired ~2 months before discovery |
| `JWT_SECRET` strength | 64 lowercase hex characters = **256 bits of entropy** (`openssl rand -hex 32`), no dictionary content |
| Secret recoverable from token? | No. HS256 leaks no key material; the only attack is offline brute force, infeasible at 256 bits |
| Repository visibility | `github.com/argeebantang/kitchen-erp` |

Because the token is expired *and* the signing key is not brute-forcible, the committed blob
has no residual exploit value. History was therefore **left intact**.

What a rewrite would have cost, for the record:

- `git filter-repo`/BFG rewrites every commit from `df3ad90` forward — all 7 commit SHAs change.
- Requires `git push --force` to `main`.
- **It would not fully clean GitHub anyway**: PR #1 is merged, and its commits stay reachable
  through `refs/pull/1/head` after a force-push. Fully purging them needs GitHub Support to run
  GC, or deleting and recreating the repository.
- Any existing clone or CI cache still holds the old objects.

The cheaper and strictly more complete remedy for a leaked-token scenario is **rotating
`JWT_SECRET`**, which invalidates every token ever signed with it. That is not required here
(the key itself never leaked), but it is the lever to reach for if a secret is ever exposed —
rewriting history is theatre by comparison, because it cannot un-copy what was already cloned.

### Follow-up

Use `curl -c /tmp/cookies.txt` (outside the repo) when testing auth by hand, not a cookie jar
written into the project root.

## 2. Deleted `prisma.config.ts`

### What changed

Deleted `prisma.config.ts`.

### Why

The file imported `defineConfig`/`env` from `prisma/config`, an API introduced in **Prisma 6.4+**.
This project is pinned to **Prisma 5.22.0**, where that module does not exist. The file was:

- **Inert** — Prisma 5.x does not read `prisma.config.ts` at all. Its 5.x configuration lives in
  the `package.json` `"prisma"` key (the `seed` entry) and in `schema.prisma`'s `datasource` block.
- **Breaking CI** — it was the *only* error in `npx tsc --noEmit`:
  `prisma.config.ts(5,35): error TS2307: Cannot find module 'prisma/config'`, failing the
  Typecheck step in `.github/workflows/ci.yml`.

Every value it declared was already the default or already configured elsewhere: `schema` at
`prisma/schema.prisma`, `migrations.path` at `prisma/migrations`, `datasource.url` from
`env("DATABASE_URL")` (already in `schema.prisma`), and `engine: "classic"` (the only engine in 5.x).

### Delete vs. upgrade to Prisma 6

Deletion was chosen. Upgrading a major version to make a file that does nothing become valid
inverts the cost/benefit: Prisma 6 carries breaking changes and deserves its own deliberate
change, not a side effect of clearing a typecheck error mid-sprint.

There is also a trap in the naive upgrade path worth recording: **from Prisma 6.4+, the presence
of `prisma.config.ts` disables the `package.json` `"prisma"` key entirely.** Upgrading without
moving `"seed": "tsx prisma/seed.ts"` into the config file would have silently broken
`prisma db seed` — a failure that surfaces later, as an empty database, not as an error at
upgrade time.

## 3. Baselined Prisma migrations

### What changed

- Added `prisma/migrations/migration_lock.toml` (`provider = "postgresql"`).
- Added `prisma/migrations/0_init/migration.sql` — 443 lines of DDL representing the full
  current 22-table schema.
- Marked it as already applied in the dev database via `prisma migrate resolve --applied 0_init`.

### Why

The schema had only ever been applied with `prisma db push`, leaving no migration history
(see `docs/database.md`). Every Week 2+ schema change (`item_prices`, then production costing,
conversion costing, `writeoffs`, and the AI tables) alters tables that will hold real data.
Those need to arrive as reviewable, replayable SQL — not as in-place pushes with no record.

Doing this *before* the first Week 2 schema change means `item_prices` lands as migration #2
with a readable diff, rather than being invisibly pushed.

### What baselining actually involves

Generate SQL for the current schema as though from an empty database, then tell Prisma it is
already applied — so it is never actually run against a database that already has those tables:

```bash
mkdir -p prisma/migrations/0_init
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/0_init/migration.sql
npx prisma migrate resolve --applied 0_init
```

`migrate resolve --applied` inserts a row into the `_prisma_migrations` bookkeeping table. From
that point Prisma believes `0_init` ran, so it sees no drift and `migrate dev` produces only
incremental migrations.

### The failure this avoids

Running `prisma migrate dev` directly against a `db push` database with no `migrations/`
directory does **not** quietly adopt the existing schema. Prisma detects that the database is
not empty and has no migration history, reports drift, and offers to **reset the database** —
dropping every table and all data. On a local dev database that costs a re-seed; against
anything real it is unrecoverable. Baselining is precisely the step that prevents that prompt
from ever appearing.

### Verification performed before baselining

`migrate diff --from-schema-datasource --to-schema-datamodel` reported **"No difference
detected"**, confirming the live database matched `schema.prisma` exactly.

This check matters: `--from-empty` generates SQL from the *schema file*, not from the *database*.
Had the two diverged (a hand-run `ALTER`, a partially-applied push), the baseline would have
encoded the schema file's version of reality and the drift would have stayed hidden until some
later migration failed on a mismatched column.

## Files affected

| File | Change |
|---|---|
| `cookies.txt` | Deleted (untracked + removed from disk) |
| `.gitignore` | Added `cookies.txt`, `*.cookies` |
| `prisma.config.ts` | Deleted |
| `prisma/migrations/migration_lock.toml` | Added |
| `prisma/migrations/0_init/migration.sql` | Added (443 lines) |

## Database changes

No schema change. The only database write was the `_prisma_migrations` bookkeeping row inserted
by `migrate resolve --applied`. No table, column, or row of domain data was altered.

## API / UI / configuration changes

None. No runtime code was touched — `prisma.config.ts` was never loaded by Prisma 5.22, and
`cookies.txt` was never read by the application.

## How to verify

```bash
# 1. cookies.txt is gone and stays ignored
test ! -f cookies.txt && echo "gone"
echo "test" > cookies.txt && git status --short cookies.txt   # expect no output
rm cookies.txt

# 2. CI's failing step now passes
npx tsc --noEmit          # expect: no output
npm run lint
npx prisma validate

# 3. Migration history is established and in sync
npx prisma migrate status # expect: "1 migration found" + "Database schema is up to date!"

# 4. The app still runs against the same database
npm run dev               # log in at /login with admin@kitchen.com / password123
```

## Risks, assumptions, follow-up

- **Assumption:** `JWT_SECRET` in `.env` has not been reused in any other environment. It was
  verified to be 256-bit random and is not itself committed (`.env` is gitignored), so the
  committed token does not expose it. If that secret was ever copied into a deployed
  environment, rotate it there.
- **Accepted:** git history still contains the expired token. Justified above; revisit only if
  the repository's threat model changes (e.g. it becomes public and the token were still live).
- **Risk (low):** the `0_init` baseline is only as accurate as the `--from-empty` diff. It was
  verified against the live database first, and `migrate status` reports in-sync. Should a
  future `migrate dev` unexpectedly report drift, that assumption is where to look.
- **Follow-up:** a Prisma 6 upgrade remains open as its own change. When done, move the
  `package.json` `"prisma"` seed key into a (then-valid) `prisma.config.ts`.
- **Follow-up:** `prisma db push` should no longer be used on this project. All schema changes
  from here go through `npx prisma migrate dev --name <change>`.
