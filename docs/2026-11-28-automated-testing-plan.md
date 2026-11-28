# Automated testing — plan

**Status: subtask 1 (unit tests) built 2026-11-28; subtasks 2–6 planned.** Week 12 task, before the deploy's CI/CD step. The roadmap's
"GitHub Actions CI/CD: test → build → deploy" needs a test step to exist first.

## Why

CI today ([.github/workflows/ci.yml](../.github/workflows/ci.yml)) runs typecheck, lint, `prisma validate` and the
production build. None of these runs the code, so a wrong stock figure, a broken approval rule or a lost row lock
reaches `main` unnoticed. Every check so far has been by hand, per task.

## The three layers

| Layer | What it tests | Tool | Needs | When |
|---|---|---|---|---|
| **Unit** | Pure functions: FEFO lot planning, variance, dates, decimals, role checks, redirects | Vitest | Nothing | Subtask 1 |
| **Integration** | Services against a real Postgres + Redis: workflows, approvals, stock, locks | Vitest | Test DB, Redis | Subtasks 2–5 |
| **End-to-end** | A browser clicking through the app | Playwright | Running app | Later, after deploy (not in this task) |

The integration layer matters most here. The rules that can lose money or stock live in services and repositories,
not in pure functions.

## Decisions

| Area | Decision | Why |
|---|---|---|
| Runner | **Vitest 4.1.12**, not Jest | Runs TypeScript and ESM directly. Jest needs ts-jest or babel and module mapping for the same result. Vitest 5 requires `@types/node` ≥ 22 and the project is on 20, so 4.1.12 (the 4.x maintenance line) avoids bumping the Node types. |
| Path alias | One `resolve.alias` line in `vitest.config.ts` (`'@'` → the project root), no `vite-tsconfig-paths` | One dependency fewer. The alias matches only `@/…`, never `@prisma/client`. |
| Vite | `vite` 7.3.7 pinned as a dev dependency, plus `"overrides": { "vite": "$vite" }` in `package.json` | npm 10.9 crashes (`Cannot read properties of null (reading 'edgesOut')`) on Vitest's optional peers: it picks Vite 8 for the peer set, and Vite 8's optional `@vitejs/devtools` peer loops back to `vitest@*`. Vite 7 has no such peer, and the override keeps every copy on the root version. Remove the override once npm fixes the bug or the project moves to Vitest 5. |
| Database in tests | **Real Postgres, Prisma not mocked** | The rules worth testing are database behaviour: `updateMany({ where: { id, status } })` guards, `SELECT … FOR UPDATE` locks, a ledger row and a level change in one transaction. A mocked Prisma only checks that the code called the mock. |
| Test database | `kitchen_erp_test` in the same Docker Postgres container | Nothing new to install. `prisma migrate reset` creates it and applies every migration. |
| Guard | Integration setup **refuses to run unless the database name ends in `_test`** | `migrate reset` and the truncate wipe everything. The dev database holds the 90-day history data. |
| Redis in tests | Same Redis container, **database 1** (`redis://localhost:6379/1`) | Services enqueue BullMQ jobs (`lib/queue.ts`) and publish live updates (`lib/realtime.ts`). On database 0, a running `npm run worker` would pick up test jobs and send real notifications and emails. |
| Worker | Not run in tests | Tests check that a job was queued, not that an email arrived. Email and job tests come later if needed. |
| Claude API | Never called. `ANTHROPIC_API_KEY` is empty in tests | AI features return "not set up". No cost and no flaky network calls. |
| Test env vars | Set in `vitest.config.ts`, no `.env.test` file | `.gitignore` ignores `.env*`, and the values are not secrets. `TEST_DATABASE_URL` / `TEST_REDIS_URL` override them. |
| What a test calls | **Service functions directly**, not HTTP routes | Services return `{ success, data } \| { success, error, status }`, so a test can check a 409 or 403 without HTTP. Route handlers are thin zod + header mapping. |
| Isolation | Every table except `_prisma_migrations` truncated before each test; test files run one at a time | One shared database. Running files in parallel would let tests see each other's rows. |
| Fixtures | `tests/helpers/fixtures.ts`: a kitchen, an outlet, one user per role, a supplier, a few materials and a finished good with a BOM | Every workflow test needs the same starting world. The full seed is too big and changes with the demo. |
| Layout | `tests/unit/**`, `tests/integration/**`, `tests/helpers/**` | Keeps tests out of `app/`. Vitest projects split unit (no setup) from integration (database setup). |
| Prisma import | Test helpers may import `lib/prisma` (truncate, fixtures, assertions) | Exception to "only repositories import Prisma", for tests only. Services stay unchanged. |
| Coverage | No percentage target | Aim at the risky flows. A number invites tests of getters. |

## Commands (once built)

```bash
npm test                  # unit + integration
npm run test:unit         # no database needed, a few seconds
npm run test:integration  # needs docker compose up (Postgres + Redis) — subtask 2
npm run test:watch        # re-runs on save
```

## Subtasks

1. **Vitest + unit tests** — **built 2026-11-28: 8 files, 87 tests, under 1 s.** Vitest and Vite as dev
   dependencies, the scripts, and unit tests for:
   - `planFefoTakes` ([repositories/finished-good-stock.repository.ts](../repositories/finished-good-stock.repository.ts)):
     soonest expiry first, expired lots skipped, never below zero
   - [lib/transfer-variance.ts](../lib/transfer-variance.ts), [lib/decimal.ts](../lib/decimal.ts)
   - [lib/dates.ts](../lib/dates.ts): `expiryFlag`, `monthGrid`, `addMonths`, Manila day boundaries
   - `stockStatus`, `reorderAlerts`, `scaleBomQuantities`, `isLate`, `presetPeriod`, `periodDays`
   - security helpers: `safeNextPath` (no open redirect), `toolsFor(role)`, `canDraft`, `canUseAssistant`
   - `parseFindings`, `keepKnownFindings` (AI output never invents figure ids)
2. **Integration harness.** Vitest integration project, global setup (`_test` guard, `prisma migrate reset --force
   --skip-seed`), Redis database 1, a truncate before each test, fixtures. One smoke test: create a material through
   its service and read it back.
3. **Procurement flow.** PR → approve → PO → send → RR → approve. Checks:
   - stock in with the ledger row
   - accepted ≤ ordered per PO line
   - no self-approval, ADMIN included
   - rejecting needs a reason
   - deciding twice → 409
4. **Production, conversion and write-off.** Checks:
   - approval and stock sufficiency
   - completion consumes materials and receives finished-good lots
   - costing
   - conversion and write-off take lots FEFO
5. **Transfers and concurrency.** Checks:
   - transfer → receive with variance
   - stock request and return
   - outlets hold no raw materials
   - **two approvals of the same document at once → exactly one succeeds, the other gets 409, and stock moves once**
6. **CI.** Postgres 16 and Redis 7 service containers in `ci.yml`, then `prisma migrate deploy` and `npm test`, before
   the build step. A red test blocks the PR.

Each subtask is handed over with the command to run. The owner runs it.

### Subtask 1 — what was built

| File | Covers |
|---|---|
| `vitest.config.ts` | Test env (test DB URL, Redis db 1, no AI/email keys), `@` alias, `unit` project |
| `tests/unit/fefo.test.ts` | `planFefoTakes`: order, exact fit, expired-at-now skipped, no-expiry lots, short, decimals |
| `tests/unit/dates.test.ts` | Manila day/time, `businessDayRange`, `addDays`/`addMonths`, ISO weeks (2026-W53), `monthGrid`, `expiryFlag` boundaries |
| `tests/unit/decimal.test.ts` | Exact arithmetic, display trimming and rounding, transfer variance reasons |
| `tests/unit/stock.test.ts` | `stockStatus`, `reorderAlerts` (OUT before LOW, stable), `scaleBomQuantities` |
| `tests/unit/safe-next.test.ts` | Open-redirect refusals, login loop, query/hash kept |
| `tests/unit/assistant-roles.test.ts` | Assistant and draft roles; `toolsFor` per role, with and without the AI reader DB |
| `tests/unit/ai-findings.test.ts` | `parseFindings` refusals, `keepKnownFindings` (cap after dropping invented ids), `findingsAbout` |
| `tests/unit/periods.test.ts` | Report presets across year and February ends, `periodDays`, `periodLabel`, `isLate` around the cut-off and the UTC/Manila day change |

Checked by planting bugs: changing the expiry skip from `<=` to `<` in `planFefoTakes` fails a test. Removing
`safeNextPath`'s `//` check fails none: its URL-origin check also refuses `//evil.example`, so that line is a second
layer and the behaviour is still pinned.

Noticed, not changed: `isLate(neededOn, now, cutoff)` takes "today" from the system clock but the time of day from
`now`. Both callers pass `new Date()`, so they agree. A caller passing another moment would get mixed results. The
test fakes the clock to keep them one moment.

## Risks and assumptions

- **Wiping the wrong database.** Covered by the `_test` name guard. It is checked before `migrate reset` and again
  before each truncate.
- **Shared Redis.** Database 1 keeps test jobs away from the dev worker. Assumes nobody runs a worker against
  database 1.
- **`lib/config.ts` throws at import** on a missing variable. The Vitest config sets all four required ones.
- **Time-dependent rules** (expiry, late requests, Manila day boundaries): tests pass `now` where the function takes
  it and use fake timers (`vi.setSystemTime`) where it does not.
- **Slower CI.** Integration tests add roughly a minute (service containers + migrations). Still free on GitHub
  Actions.
- **No refactors for testability** unless a service cannot be called without HTTP. Any such change gets its own
  note.

## Follow-up (not in this task)

- Playwright smoke tests against the deployed app (login, approve one document, receive a transfer by QR).
- Tests for the worker's scheduled jobs (EOD snapshot, escalation, weekly summary) with a mocked email sender.
