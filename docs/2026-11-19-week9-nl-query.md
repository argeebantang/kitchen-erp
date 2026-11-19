# 2026-11-19 — Natural Language Query: the dashboard assistant (Week 9, Task 3)

Week 9 roadmap task "FEATURE 2 — Natural Language Query: chat box on dashboard. User types any question. Claude
uses function calling to decide which DB query to run, executes it, formats the answer. Example: 'Magkano ang
gastos namin ngayong buwan?' → Claude calls get_production_costs({period: 'this_month'}) → answers in Filipino."
It is the second AI feature on the Task 1 foundation (`docs/2026-11-18-week9-claude-api-integration.md`).

What it gives:
- **An "Ask KitchenAI" card on the Dashboard** for ADMIN, ACCOUNTING and PRODUCTION_MANAGER. You type a question in
  English, Filipino or Taglish, and get a short plain-text answer from the system's own data.
  - Under each answer: what was looked up ("Looked up: production costs, Nov 16 – Nov 19") and what the question
    cost.
  - For a database query, **"How I got this"**: the SQL and how many rows it returned.
  - Follow-ups work ("and last week? compare them"). The page keeps the conversation; the server stores none of it.
- **Two tools Claude picks from:**
  - `get_production_costs`: the verified figures from the Costing dashboard, for any cost question.
  - `run_query`: Claude writes one read-only SQL query for anything else (stock, users, purchases, transfers, …).
    It runs through a separate Postgres login, `kitchen_ai_reader`, which can only read an allow-list of tables
    and columns.

Built in subtasks 3.1–3.5. Steps are in `docs/week9-task3-subtasks.xlsx` (not in git). 3.3 and 3.4 were swapped
during the task, so the cost question was answered before the SQL tool was built.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| Scope | The chat box, the tool loop and two tools. The roadmap's other read functions, write actions, the query log and streaming are later Week 9 tasks | The owner wanted an assistant that can answer anything ("how many users do we have?"), with exact figures when the question is about cost |
| F1 | **Our own tool loop** in `AiService.converse()`, not the SDK's beta Tool Runner. Every round goes through the budget check, records its own `AiCall` and maps errors as in Task 1. At most 5 rounds per question | Keeps Task 1's guarantees (soft budget, cost per call, readable errors) on every round. Caps a question at roughly $0.05 |
| F2 | `get_production_costs(period)`: today, this week, last week, this month, last month, or custom from–to (at most 366 days). Manila business days, weeks Monday to Sunday. The same rows and rules as `/costing`, computed in Decimal by `CostingService.productionCosts()`. Claude is told to use it for every cost question | **Code calculates, Claude explains**: money answers come from tested code, not from SQL Claude wrote |
| F3 | `run_query` through the Postgres role `kitchen_ai_reader`. SELECT on 27 tables; on `User` only `id`, `name`, `role`, `branchId`, `createdAt`. No `AiCall`, `AiInsight`, `Notification`. Read-only transaction, 5 s timeout, at most 200 rows. Its password is only in `.env` | **Postgres enforces it**, not the prompt or a check of the SQL text. A clever query cannot reach what the role cannot read |
| F4 | ADMIN, ACCOUNTING, PRODUCTION_MANAGER. Other roles see "The KitchenAI assistant is not available for your role yet." | These roles already see costs and production across all branches. See the noted limitation below |
| F5 | The page sends the last 6 messages with each question. Nothing is stored on the server until the query-log task | Follow-ups work with no new table |
| F6 | `AiFeature.ASSISTANT`: Sonnet 5.5, effort `low`, 4,000 max tokens per round, prompt caching on | About $0.002–0.014 and 2–7 s per question |
| F7 | Plain text, short paragraphs or "- " lines, no Markdown, in the language of the latest message. No SQL, table names, ids or tool names in the answer | The card shows the text as written. "How I got this" holds the SQL |
| Noted | **Grants are per table and column, not per row or per app role.** A branch manager given the assistant would see other branches' rows, and a procurement manager could ask about production costs. Opening the assistant to those roles needs Postgres row-level security or curated functions | The owner: "note this for now" |
| Answers | "Gastos" = production cost. No per-user daily limit beyond the monthly budget and the round cap | — |

## What changed

- *3.1 The card (no tools yet).*
  - Migration `20261119090000_ai_assistant`: `AiFeature` gains `ASSISTANT`. `lib/claude.ts`: `AI_FEATURES.ASSISTANT`.
  - `services/assistant.service.ts` (new): `ASSISTANT_ROLES`, `canUseAssistant()`, the limits (question 1,000
    characters, 6 earlier messages, 4,000 characters per resent message), and `ask(messages, viewer)`.
  - `app/api/ai/assistant/route.ts` (new) and its guard in `middleware.ts`.
  - `components/ai/AssistantCard.tsx` (new, Client Component):
    - example chips, user bubbles in orange, answers in purple with "Looked up" and the cost
    - a "Thinking…" spinner and "New conversation"
    - Enter sends, Shift+Enter starts a new line, and a failed question goes back into the box
  - The Dashboard renders the card for the allowed roles and a note for the others.
- *3.2 `get_production_costs`.*
  - `CostingService.productionCosts(from, to)`:
    - batch count and cost, `overPlan` (Σ `costVariance`)
    - conversion count and cost, and the total `productionCost`
    - per finished good: quantity, cost and cost per unit
    - the 5 costliest batches, and `awaitingSignOff`
  - `services/assistant-tools.ts` (new), the tool registry. Each tool has:
    - a strict JSON Schema for Claude
    - a zod check of what Claude sends (model output is untrusted input)
    - its roles, and `available()`
    - a `run()` that calls a service or repository
- *3.3 The tool loop.*
  - `AiService`:
    - `round()` is one Claude call: the budget check, the call, the `AiCall` row, the error mapping, refusal and
      `max_tokens`. `complete()` now calls it and works as before.
    - `converse()`: Claude answers or asks for tools. They run, and all their results go back in one user message.
      A failed lookup goes back as `is_error` for Claude to correct, and Claude is called again, up to `maxRounds`.
    - A failed round fails the question. The rounds before it stay recorded.
    - Prompt caching: one breakpoint after the fixed instructions, plus automatic caching of the growing
      conversation.
    - `estimateUsage` is no longer exported.
  - `AssistantService.ask()`:
    - offers `toolsFor(role)` and runs the tool Claude picked
    - collects "Looked up" labels
    - sends today's Manila date and this week as context after the cached instructions
- *3.4 Read-only login and `run_query`.*
  - Migration `20261119100000_ai_reader_role` (see Database).
  - `lib/config.ts`: optional `aiDatabaseUrl` (`AI_DATABASE_URL`).
  - `repositories/ai-reader.repository.ts` (new): its own Prisma client on that URL. Each query runs in a
    transaction with:
    - `SET TRANSACTION READ ONLY` and `SET LOCAL statement_timeout`
    - the SQL wrapped as `SELECT * FROM (\n…\n) AS ai_query LIMIT 201`. Only one statement can run, and the limit
      is ours.

    Postgres errors (P2010) come back as text for Claude, and anything else is thrown.
  - The `run_query` tool:
    - Its description is the table guide: columns, enum values, and the Manila-time rule for `…At` columns versus
      date-only columns.
    - Rows go to JSON: money as text, times as ISO UTC, long text cut at 300 characters, about 40,000 characters
      at most.
    - It's offered only when `AI_DATABASE_URL` is set.
  - The instructions are built from the tools actually offered (`instructionsFor`), so Claude is never told about
    a tool it does not have.
  - The card: the "How I got this" fold-out.
- *3.5 Docs.* This note; `progress.md`; `database.md`, `api.md`, `architecture.md`, `overview.md`; the roadmap.

## Database

Two migrations, both additive:
- `20261119090000_ai_assistant`: `ALTER TYPE "AiFeature" ADD VALUE 'ASSISTANT'`. Not used in the same
  migration, so it is safe inside its transaction.
- `20261119100000_ai_reader_role`:
  - Creates the role `kitchen_ai_reader` `NOLOGIN`, with no password, only `IF NOT EXISTS`. Roles belong to the
    whole server, so this is safe on shadow databases and on re-runs.
  - Role settings: `default_transaction_read_only = on`, `statement_timeout = 5s`,
    `idle_in_transaction_session_timeout = 10s`.
  - `USAGE` on schema `public`.
  - `SELECT` on `Branch`, `Category`, `Unit`, `Material`, `ItemPrice`, `FinishedGood`, `BOM`, `BOMItem`,
    `Supplier`, `PurchaseRequest`, `PurchaseRequestItem`, `PurchaseOrder`, `PurchaseOrderItem`,
    `ReceivingReport`, `ReceivingReportItem`, `InventoryLevel`, `StockMovement`, `StockTransfer`,
    `StockTransferItem`, `FinishedGoodLot`, `FinishedGoodLevel`, `FinishedGoodMovement`, `ProductionOrder`,
    `ProductionStatusChange`, `ConversionOrder`, `WriteOff`, `Approval`.
  - Column-level `SELECT ("id", "name", "role", "branchId", "createdAt")` on `User`.
  - Not granted: `User.email`, `User.passwordHash`, `User.updatedAt`, `AiCall`, `AiInsight`, `Notification`,
    `_prisma_migrations`.
  - It needs a migration user with `CREATEROLE`. The local `kitchen` user is a superuser.

Still 31 models, and no data is touched. A table added by a later migration is **not** readable by the assistant
until a migration grants it on purpose.

## API

`POST /api/ai/assistant`, for ADMIN, ACCOUNTING and PRODUCTION_MANAGER (middleware).
- Body `{ messages: [{ role: 'user' | 'assistant', content }] }`: 1–7 messages, each 1–4,000 characters after
  trimming. The last one is the question (role `user`, at most 1,000 characters).
- 200 `{ answer, lookups: [{ tool, label, query: { sql, rowCount, truncated } | null }], costUsd }`. `costUsd` covers
  all rounds together.
- 400 validation, or Claude declined · 422 too many lookups (more than 5 rounds) · 429 budget used up or rate
  limited · 502 key rejected, cut off, or another API error · 503 not set up, unreachable or overloaded. These are
  the same AI statuses as every AI endpoint.
- Each round is one `AiCall` row (`ASSISTANT`) recorded against the caller.

## UI

- Dashboard: the "Ask KitchenAI" card at the top for the three roles, and the "not available for your role yet"
  note for the others.
- AI Settings lists the rounds as "Assistant". A question that needs a lookup is usually 2 rows: one to look up,
  one to answer.

## Configuration

`AI_DATABASE_URL`, optional. Leave it empty and the assistant answers cost questions only; it is not offered
`run_query`. To switch it on for a database server, once:

```bash
# Postgres: give the role a password and let it log in. Use your own server's admin login.
PW=$(openssl rand -hex 24)
printf "ALTER ROLE kitchen_ai_reader LOGIN PASSWORD '%s';\n" "$PW" \
  | docker compose exec -T postgres psql -U kitchen -d kitchen_erp -q
# .env: the same host and database as DATABASE_URL, with the new user
printf 'AI_DATABASE_URL="postgresql://kitchen_ai_reader:%s@localhost:5432/kitchen_erp?schema=public"\n' "$PW" >> .env
unset PW
```

Then restart `npm run dev`. In development, Next.js also reloads `.env` changes by itself.
- Keep a single `AI_DATABASE_URL` line in `.env`. A second, empty `AI_DATABASE_URL=` below it (for example the
  block copied from `.env.example`) wins and turns `run_query` off. This happened once during testing.
- Never commit the password. `.env` is gitignored, and `.env.example` has the key empty.

The local database was switched on during 3.4 with a random password, which was never printed.

## How to verify

1. Sign in as accounting, open the Dashboard and ask "What is the production cost this week?". The answer should
   match the Costing dashboard's This week, with "Looked up: production costs, …" and no SQL.
2. Ask "and last week? compare them". Both weeks appear, from a single turn.
3. Click the chip "Magkano ang gastos namin ngayong buwan?". The answer is in Filipino.
4. Ask "How many users do we have?". The answer comes with "How I got this", showing the SQL and the row count.
5. Ask "Show me the email addresses of all users". It says it cannot look that up.
6. Sign in as a viewer, branch manager or procurement manager. You see the "not available" note, and the
   endpoint redirects to `/unauthorized`.
7. Lock check, in a terminal:
   `docker compose exec postgres psql -U kitchen -d kitchen_erp -c "SET ROLE kitchen_ai_reader; SELECT email FROM \"User\";"`
   Expected: permission denied.

What was checked:
- `get_production_costs` for every period, against hand-worked figures and `/costing`: this week ₱4,390.15, last
  week ₱2,484.65, this month ₱6,874.80, Oct 28 – Nov 10 ₱4,969.30 at ₱160.30/kg, the 4-week total ₱9,359.45.
  7 bad inputs gave readable errors.
- `run_query` directly, 14 cases:
  - Allowed: users by role, money and dates, a trailing `--` comment.
  - Refused by Postgres: `email`, `SELECT *` on User, `AiCall`, `UPDATE`, a `DELETE` inside a `WITH`, two
    statements, breaking out of the wrapper, and `set_config('transaction_read_only','off')`.
  - Limits: `pg_sleep(7)` was stopped at 5 s, and 500 rows were cut to 200 with a note.
  - Material's row count was unchanged afterwards.
- About 15 real questions, all figures correct:
  - cost this week, this month (Filipino), a follow-up with 2 lookups in one turn, a custom range
  - users, pork belly stock, low stock (Filipino), "yield" (no lookup), users' emails (refused)
  - with and without `AI_DATABASE_URL`
- Caching: rounds after the first read about 1,450–1,700 tokens from cache.
- Branch, viewer and procurement users were refused by middleware.
- `tsc`, lint, no migration drift.

## Risks, assumptions, follow-ups

- **Not per branch, not per role** (Noted, F3/F4). Do not add BRANCH_MANAGER or PROCUREMENT_MANAGER to
  `ASSISTANT_ROLES` before row-level security or curated functions exist.
- **SQL answers are Claude's query.** The numbers are what Postgres returned, but the query may not be what the
  user meant (wrong join, wrong date range). "How I got this" lets someone check it. Money questions should keep
  going to `get_production_costs`, as the instructions say.
- **The table guide is hand-written** in `services/assistant-tools.ts`. When the schema changes, update it and the
  grants in a new migration, or Claude will get errors and say it cannot look the data up.
- Questions, query results and figures go to Anthropic (see Task 1's risks; API data is not used for training by
  default). Readable data includes supplier contact details and branch addresses, but not users' emails.
- The role needs `CREATEROLE` for the migration on a managed database. If the deploy user lacks it, create the
  role by hand first. The `IF NOT EXISTS` then skips creation, and the grants still run.
- The rounds of one question are not grouped in `AiCall`. The query-log task (Week 9) will record the question,
  the tools and the answer.
- Not built yet: streaming (answers arrive whole, 2–7 s), write actions, the query log, and the remaining named read
  functions. `run_query` covers their data for now.
