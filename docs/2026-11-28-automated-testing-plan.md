# Automated testing — plan

**Status: subtasks 1–6 built 2026-11-28 (unit tests, integration harness, procurement, middleware access, production / conversion / write-off, transfers and concurrency); subtask 7 (CI) planned. Subtask 5 found a real bug, fixed the same day (`docs/2026-11-28-pending-write-off-lots.md`).** Week 12 task, before the deploy's CI/CD step. The roadmap's
"GitHub Actions CI/CD: test → build → deploy" needs a test step to exist first.

## Why

CI today ([.github/workflows/ci.yml](../.github/workflows/ci.yml)) runs typecheck, lint, `prisma validate` and the
production build. None of these runs the code, so a wrong stock figure, a broken approval rule or a lost row lock
reaches `main` unnoticed. Every check so far has been by hand, per task.

## The layers

| Layer | What it tests | Tool | Needs | When |
|---|---|---|---|---|
| **Unit** | Pure functions: FEFO lot planning, variance, dates, decimals, role checks, redirects | Vitest | Nothing | Subtask 1 |
| **Middleware** | `middleware()` called with a real signed JWT per role: who reaches which URL, how refusals look, which identity reaches the routes | Vitest (in the unit project) | Nothing | Subtask 4 |
| **Integration** | Services against a real Postgres + Redis: workflows, approvals, stock, locks | Vitest | Test DB, Redis | Subtasks 2, 3, 5, 6 |
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
| Test env vars | `tests/helpers/test-env.ts`, used by `vitest.config.ts` and the global setup; no `.env.test` file | `.gitignore` ignores `.env*`, and the values are not secrets. Database and Redis: `TEST_DATABASE_URL` / `TEST_REDIS_URL` if set (CI), else your `.env`'s `DATABASE_URL` with `_test` appended to the name and `REDIS_URL` on database 1, else the docker-compose defaults. Only those two variables are read from `.env`, never its API keys. |
| What a test calls | **Service functions directly**, not HTTP routes; **`middleware()` directly** for access (subtask 4) | Services return `{ success, data } \| { success, error, status }`, so a test can check a 409 or 403 without HTTP. Route handlers are thin zod + header mapping. Middleware was added after subtask 3 showed the gap: the decision services do not check the role ("No role check here" in `PurchaseRequestService.applyDecision`), so `/api/approvals` in `ROLE_GUARDS` was the only thing keeping a VIEWER from approving, and no test passed through it. |
| Isolation | Every table except `_prisma_migrations` truncated before each test; test files run one at a time | One shared database. Running files in parallel would let tests see each other's rows. |
| Fixtures | `tests/helpers/fixtures.ts`: a kitchen, an outlet, one user per role, a supplier, a few materials and a finished good with a BOM | Every workflow test needs the same starting world. The full seed is too big and changes with the demo. |
| Layout | `tests/unit/**`, `tests/integration/**`, `tests/helpers/**` | Keeps tests out of `app/`. Vitest projects split unit (no setup) from integration (database setup). |
| Prisma import | Test helpers may import `lib/prisma` (truncate, fixtures, assertions) | Exception to "only repositories import Prisma", for tests only. Services stay unchanged. |
| Coverage | No percentage target | Aim at the risky flows. A number invites tests of getters. |

## Commands

```bash
npm test                  # unit + integration (needs docker compose up)
npm run test:unit         # no database needed, a few seconds
npm run test:integration  # needs docker compose up (Postgres + Redis)
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
2. **Integration harness** — **built 2026-11-28: 7 integration tests + 9 guard unit tests, about 5 s including the
   database rebuild.** Vitest integration project, global setup (`_test` guard, `prisma migrate reset --force
   --skip-seed`), Redis database 1, a truncate before each test, fixtures. Smoke test: create a material through its
   service and read it back.
3. **Procurement flow** — **built 2026-11-28: 25 integration tests, about 10 s.** PR → approve → PO → send → RR → approve. Checks:
   - stock in with the ledger row
   - accepted ≤ ordered per PO line
   - no self-approval, ADMIN included
   - rejecting needs a reason
   - deciding twice → 409
4. **Middleware access** — **built 2026-11-28: 67 tests, no database, under a second.** Added after subtask 3
   (see Decisions, "What a test calls"). Who reaches which URL, per role; refusals; tokens; forwarded identity.
5. **Production, conversion and write-off** — **built 2026-11-28: 30 integration tests + 4 unit tests, about 15 s.** Found a real bug (below). Checks:
   - approval and stock sufficiency
   - completion consumes materials and receives finished-good lots
   - costing
   - conversion and write-off take lots FEFO
6. **Transfers and concurrency** — **built 2026-11-28: 16 transfer + 9 concurrency integration tests, about 20 s.** Checks:
   - transfer → receive with variance
   - stock request and return
   - outlets hold no raw materials
   - **two approvals of the same document at once → exactly one succeeds, the other gets 409, and stock moves once**
7. **CI.** Postgres 16 and Redis 7 service containers in `ci.yml`, then `prisma migrate deploy` and `npm test`, before
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

### Subtask 2 — what was built

| File | What it does |
|---|---|
| `tests/helpers/test-env.ts` | The test environment (see Decisions), plus `assertTestDatabase` (name must end in `_test`) and `assertTestRedis` (database 1 or above) |
| `tests/helpers/global-setup.ts` | Once per run: both guards, Redis reachable (clear message if not), flush Redis db 1, `prisma migrate reset --force --skip-seed --skip-generate` on the test database (creates it if missing) |
| `tests/helpers/database.ts` | `resetDatabase()`: checks `current_database()` really ends in `_test`, then truncates every table but `_prisma_migrations` in one statement (`RESTART IDENTITY CASCADE`) and flushes Redis db 1. `closeConnections()`: queues, realtime publisher, Prisma |
| `tests/helpers/integration-setup.ts` | `resetDatabase()` before each test, `closeConnections()` after each file |
| `tests/helpers/fixtures.ts` | `createWorld()`: kg/pc units; Meat, Spices, Roasts categories; Main Kitchen (COMMISSARY) and Cubao Outlet (OUTLET); one user per role plus a second accountant (for self-approval and two-at-once tests); a supplier; Whole Pig (₱250) and Rock Salt (₱40) with reference prices (no supplier) since yesterday — a purchase request has no supplier, so only a reference price can cost it; Lechon (48 h shelf life) with a 10 kg recipe of 12 kg pork + 0.5 kg salt |
| `tests/integration/harness.test.ts` | Connected to `*_test`; every migration applied; fixtures build; service create + read back; a refusal comes back as `{ success: false, status: 409 }`; every test starts empty; queues use Redis db 1 |
| `tests/unit/test-env.test.ts` | The guards refuse `kitchen_erp`, `kitchen_erp_test_backup`, no name, Redis 0 / none / non-numeric |

Integration files run one at a time: a project with `fileParallelism: false` gets `maxWorkers = 1`, and Vitest puts
its files in a sequential group (checked in Vitest 4.1.12's source). Unit files stay parallel.

Checked against the real services: with `TEST_DATABASE_URL` set to the dev database the run stops with "Refusing to
use database "kitchen_erp"" before connecting; with `TEST_REDIS_URL=redis://localhost:6379/0` it stops with
"Refusing Redis database 0". After both, the dev database still had its 571 production orders and Redis db 0 its 500
keys.

### Subtask 3 — what was built

`tests/helpers/procurement.ts` holds the workflow as steps, each through the real service as the API routes call it:
`submittedRequest`, `approveRequest`, `sentOrder`, `orderReadyToReceive`, `countInput`, `submittedReceipt`, and
`stockOf` (a stock level as a string). `ok(result)` unwraps a step that must succeed and otherwise fails with the
service's own message. `as(user)` builds the `{ userId, role }` viewer the services take. Subtask 5 reuses them.

`tests/integration/procurement.test.ts` (25 tests):

| Area | Pins |
|---|---|
| Whole flow | Request approved → `CONVERTED_TO_PO` and a draft order at the reference prices. No stock before the delivery is approved, then: stock levels, one `IN` ledger row per line at the order's cost pointing at the report, the order `FULLY_RECEIVED`, and three approvals on record |
| Supplier pricing | Choosing a supplier re-prices the order: the supplier's own price where there is one (pork ₱240), the reference price otherwise (salt ₱40), and the total |
| Notifications | Submitting a request queues `pr-submitted` on Redis db 1 |
| Several deliveries | Each approved delivery adds to stock. `PARTIALLY_RECEIVED` until complete. The second count is measured against what is still outstanding ("only 40 kg"). One open report per order (409) |
| The count | Stocks received − rejected. Refuses: more than outstanding, rejected > received, a rejection without a note, a missing line, an outlet as the receiving branch, a future date. Nothing is created when refused |
| Rejected delivery | No stock, no ledger rows, the order stays `SENT`, a fresh count can be recorded |
| Own work, ADMIN included | 403 for deciding your own request, an order you submitted, or a delivery you counted. Nothing moves |
| Decisions | Rejecting needs a reason (null, empty, spaces → 400) and creates no order. A second decision → 409, with still one order and stock moved once. A request with an unpriced line cannot be approved |
| Roles | Accounting cannot edit or submit an order. No submitting without a supplier. Only procurement records deliveries. No receiving against an order never sent. A request cannot deliver to an outlet |

Checked by planting bugs in the receiving code, one at a time, each caught by its own test: letting the counter
approve their own delivery; stocking received instead of received − rejected; marking an order fully received after
a partial delivery.

Found while writing it: the first fixtures gave the materials a supplier's price, and every approval failed with
"has no price on record". That is correct behaviour: a request has no supplier, so only a reference price counts. The
fixtures now use reference prices.

Not covered here, by design: two approvals of the same report at once. The `WHERE status` guard and the
`FOR UPDATE` lock only matter under concurrency, which is subtask 5.

### Subtask 4 — what was built

`tests/unit/middleware.test.ts` calls `middleware()` with a `NextRequest` carrying a real JWT (`signToken`, the test
`JWT_SECRET`) and reads the response. An allowed request carries `x-middleware-next: 1`, and the identity Next hands
to the route arrives as `x-middleware-request-x-user-*`. A refusal is a 307 to `/login` or `/unauthorized`, or JSON
401/403.

| Area | Pins |
|---|---|
| Who may reach what | An `ACCESS` table of 52 method + path pairs and the roles allowed through, checked for all six roles. It covers approvals, procurement, production, inventory, item-master writes vs reads (`methods`), the ADMIN-only reads (suppliers, holidays), AI and admin endpoints, and overlapping guards AND-ed (`/inventory/transfers/return` → ADMIN and BRANCH_MANAGER only). A failure lists every wrong role at once |
| Assistant | The `/api/ai/assistant` guard admits exactly `ASSISTANT_ROLES`, so the two lists cannot drift apart |
| Signed out | A page → `/login?next=…` with the path and query; no `next` for `/` or a POST; an API call from code → 401 JSON (not a redirect a form would take for success); a download link opened by the browser → sign-in; `/login` and `/api/auth/login` pass |
| Untrusted tokens | Garbage, another secret, expired, and a VIEWER token with its payload edited to ADMIN → 401, cookie cleared |
| Wrong role | API → 403 JSON "Your role cannot do this."; page → `/unauthorized` |
| Identity | `x-user-id/role/email` come from the token. The same headers sent by the caller are overwritten, and a spoofed `x-user-role: ADMIN` with a VIEWER token is still refused |

**The `ACCESS` table is written by hand on purpose.** If it were built from `ROLE_GUARDS`, it would agree with any
mistake made there. A new guard needs a row here (docs/coding-conventions.md, "Tests").

Checked by planting bugs in `middleware.ts`, one at a time:
- deleting the `/api/approvals` guard failed 3 tests
- dropping `DELETE` from `WRITE_METHODS` failed 1
- checking only the first matching guard failed 13

Noticed, not changed: public paths match by prefix (`pathname.startsWith('/login')`), so any future route starting
with `/login` or `/api/auth/login` would skip authentication too. No such route exists today.

### Subtask 5 — what was built

`tests/helpers/production.ts` provides these steps:
- `stockMaterials`: raw materials on the kitchen's shelf
- `submittedRun`, `reportedRun`, `completedRun`: a Lechon order of N × 10 kg through the real service
- `lechonLot(world, yield, expiresInHours)`: a lot cooked through the real flow, then aged by moving its expiry. Lots
  can only come from a production order or conversion (a CHECK constraint), so tests cook them.
- `lotQuantity`

The fixtures gained Lechon Paksiw (24 h shelf life) and its conversion recipe: 5 kg Lechon + 0.25 kg salt make 6 kg.

`tests/integration/production.test.ts` (30 tests):

| Area | Pins |
|---|---|
| Production run | On sign-off, the recipe at the **planned** quantity leaves stock (`OUT` −24 kg pork at ₱250, −1 kg salt at ₱40), and the yield arrives as one lot numbered after the order, expiring 48 h after the kitchen reported it. Costs: planned and actual ₱6,040, ₱335.5556/kg, variance ₱604. Nothing moves before sign-off. Stock may go negative (D3). The KitchenAI cost explanation is queued on the AI queue. A rejected completion goes back to `IN_PROGRESS` with nothing moved and can be reported again. Signing off twice → 409. No shelf life or a missing price → 409, nothing moved |
| Planning | Refused: an outlet, a past date, 0 or 101 batches, zero batch weight, roles other than production. Yield must be > 0 and ≤ 2 × planned |
| Own work | The submitter cannot decide the order; whoever reported it done cannot sign it off (ADMIN included) |
| Conversion | Takes soonest-expiry first and never an expired lot (3 kg + 2 kg; the expired 4 kg untouched). Salt goes out. Costs come from the lots' own costs + salt (₱3,624 + ₱10, ₱660.7273/kg). The Paksiw lot expires 24 h after recording. Only unexpired Lechon counts as available; pending conversions' claims count; output ≤ 2 × the recipe; kitchens and production only; never your own. Lots that expire between recording and approval → 409, nothing moved |
| Write-off | `WASTE` at the lot's cost (−4 kg at ₱755 = ₱3,020). Cannot exceed what is left after pending write-offs. Other needs notes. Never your own; a reason to reject; a rejection frees the lot; production only |
| Lot waiting to be written off | Not used by a conversion; not sent by a transfer; the unclaimed part of a lot is still used |

Checked by planting bugs, one at a time, each caught:
- lot expiry counted from approval instead of from the kitchen's report
- conversions taking expired lots
- a write-off approved by whoever recorded it

**Bug found:** a lot recorded for write-off (spoiled, damaged) but not yet expired was consumed by a conversion or
sent by a transfer approved meanwhile. The write-off could then never be approved. Confirmed (3 kg spoiled Lechon
became Paksiw lot CNV-000001), then fixed with the owner's go-ahead: see
`docs/2026-11-28-pending-write-off-lots.md`. Making the fix a no-op fails the 3 integration and 3 `withoutClaims`
unit tests.

### Subtask 6 — what was built

The fixtures now set the outlet's `managerId` to the branch manager, because who runs an outlet is read from the
branch, not from the login.

`tests/integration/transfers.test.ts` (16 tests):

| Area | Pins |
|---|---|
| Delivery | Nothing moves before approval. On approval, the lot leaves the kitchen (`TRANSFER` −6 at ₱302); in transit the outlet has none. When counted, the same lot joins the outlet (+6), variance ₱0 |
| Short receipt | Needs a reason. The variance value is short × the lot's cost (1 kg → ₱302). Reason and notes are stored |
| Receipt rules | Refused: more than sent, Other without a note, a lot left uncounted. Counted by that outlet's manager or an admin; production → 403; another outlet's manager → 404 (cannot see it). Not before approval, not twice |
| Sending | From a kitchen only. Within what it has (409 "Not enough at Main Kitchen"). Pending transfers' promises count. Never decided by the recorder; a reason to reject; a rejection moves nothing |
| Return | Leaves the outlet at once with no approval (shown as in transit). Accounting cannot decide it. Production counts it back into the kitchen. Only the outlet's manager sends one, from an outlet, to a kitchen |
| Stock request | Planned → sent → counted in full = `FULFILLED`; short = `PARTLY_FULFILLED`. Only a planned request is sent, on one delivery at a time. Asked by the outlet's own manager. The kitchen plans or declines, and a decline needs a reason. Cannot plan more than asked |

`tests/integration/concurrency.test.ts` (9 tests) fires two decisions on the same document at the same moment
(`Promise.all`, two accountants). Exactly one succeeds, the other gets 409, and stock moves once. Covered:
- purchase request (approve + approve, and approve + reject)
- receiving report
- production completion
- conversion
- write-off
- transfer approval
- transfer receipt

One more test approves a conversion, a transfer and a write-off of the same 10 kg Lechon lot at once. All three go
through, the lot ends at exactly 0, and nothing deadlocks.

**The races really reach the database.** A probe logged the losing call's message over 3 runs. Every time, it was
the database guard's ("decided by someone else just now", "decided meanwhile", "just received by someone else"),
never the service's earlier status check.

Checked by planting bugs, one at a time:
- removing the status from the purchase request decision's `WHERE` → two purchase orders; 2 tests fail
- removing it from the transfer receipt's `WHERE` → the outlet stocked twice; 1 test fails

**Noticed, not changed:** in the receiving-report race, the loser waits on the purchase order lock. Once in, it sees
the order already `FULLY_RECEIVED` and answers "The order can no longer take a delivery — nothing was changed.
Reject it and record a fresh count." Nothing is wrong in the data, but the advice is: a colleague has just approved
that report, so there is nothing to reject. In `ReceivingReportRepository.decide`, checking the report's status
before the order's would give "decided by someone else just now" instead.

## Risks and assumptions

- **Wiping the wrong database.** Covered by the `_test` name guard. It is checked before `migrate reset` and again
  before each truncate.
- **Shared Redis.** Database 1 keeps test jobs away from the dev worker. Assumes nobody runs a worker against
  database 1.
- **`lib/config.ts` throws at import** on a missing variable. `tests/helpers/test-env.ts` sets all four required ones.
- **The test database lives on the dev Postgres server.** It needs the same migration rights as the dev database
  (CREATEROLE for the AI reader role, which already exists there, so `IF NOT EXISTS` skips it). `npm test` now needs
  Docker up; `npm run test:unit` does not.
- **Time-dependent rules** (expiry, late requests, Manila day boundaries): tests pass `now` where the function takes
  it and use fake timers (`vi.setSystemTime`) where it does not.
- **Slower CI.** Integration tests add roughly a minute (service containers + migrations). Still free on GitHub
  Actions.
- **No refactors for testability** unless a service cannot be called without HTTP. Any such change gets its own
  note.

## Follow-up (not in this task)

- Playwright smoke tests against the deployed app (login, approve one document, receive a transfer by QR).
- Tests for the worker's scheduled jobs (EOD snapshot, escalation, weekly summary) with a mocked email sender.
