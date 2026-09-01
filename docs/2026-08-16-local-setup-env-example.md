# Local setup: add `.env.example`

## What changed

* Added `.env.example` — the file `lib/config.ts` and [deployment.md](deployment.md) already told developers to copy, but which did not exist in the repo.
* Added `!.env.example` to `.gitignore`. The existing `.env*` rule ignored the example file too, so it could not be committed.

## Why

Setting the project up on a new machine had no documented starting point: `lib/config.ts` throws at startup listing four required variables, and `docker-compose.yml` needs three more (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`) that nothing in the repo mentioned. The example file now covers both sets in one place, matching the fact that Compose and Next.js both read the same root `.env`.

## Files affected

* `.env.example` (new)
* `.gitignore`

Database, API, UI, and runtime configuration are unchanged — `.env.example` is documentation, not loaded by anything.

## How to verify

From a clean checkout: `cp .env.example .env`, set `JWT_SECRET` to `openssl rand -hex 32`, then `docker compose up -d && npm ci && npx prisma db push && npx prisma db seed && npm run dev`. `http://localhost:3000/login` should return 200 and the seeded users should exist.

## Follow-up work (not done here)

* `prisma.config.ts` breaks `tsc --noEmit` (the CI typecheck): it imports `prisma/config`, which does not exist in Prisma 5.22 — that API arrives in Prisma 6.4+. The file is also inert, since the 5.x CLI never reads it. Either delete it or upgrade Prisma deliberately.
* `cookies.txt` is committed at the repo root and contains a real signed `kitchen-token` JWT for `admin@kitchen.com`. It should be deleted from the repo and gitignored.
* Still no `prisma/migrations/` — this setup used `prisma db push`, per [database.md](database.md).
