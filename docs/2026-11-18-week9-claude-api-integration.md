# 2026-11-18 — Claude API integration (Week 9, Task 1)

Week 9 roadmap task "Set up Claude API integration in the backend (Anthropic SDK)". It is the foundation the rest of
Week 9 (Cost Variance Explainer, natural-language query with read and write functions, AI query log, streaming UI)
and Week 10 build on.

What it gives:
- **One door to Claude** for every AI feature: `AiService.complete()` checks the monthly budget, calls the model,
  handles refusals, cut-off answers and API errors, estimates the cost and records every call.
- **A usage log**: the `AiCall` table, one row per API call.
- **Admin → AI Settings** (`/admin/ai`):
  - whether the key is set (never the key itself)
  - each feature's model and effort
  - this month's spend against the budget, and per feature
  - the latest 20 calls
  - a **Test connection** button

Built in subtasks 1.1–1.5. Steps are in `docs/week9-task1-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | `lib/claude.ts`: a Node-only lazy client, per-feature settings and the price table. `services/ai.service.ts`: budget, call, record, error mapping. `repositories/ai-call.repository.ts`: the only Prisma access | Same split as `lib/queue.ts` + `NotificationService`. Works from the Next.js server and the worker (Feature 1 runs in a job) |
| D2 | `ANTHROPIC_API_KEY` is optional. Without it, AI features answer "AI is not set up yet" (503) and the rest of the app runs | A required key would break the CI build and every machine without one |
| D3 | **Claude Sonnet 5.5** (`claude-sonnet-5-5`) for every feature — the owner's choice. Effort is set per feature: `low` for the connection test and short write-ups, `medium` for multi-step tool use | Sonnet 5.5 always thinks, so effort is the cost lever. Its default is `high`, recalibrated from Sonnet 5, so each feature states its own |
| D4 | New table `AiCall`, one row per API call, with enums `AiFeature` and `AiCallOutcome`. Models 29 → 30 | One assistant question can take several calls, so this is not the per-question `ai_query_log`. The budget needs per-call cost, and it shows spend per feature |
| D5 | Two spending caps. **Hard:** the spend limit on a dedicated Anthropic Console workspace, set by the owner there. **Soft:** `AI_MONTHLY_BUDGET_USD` (default $20). When this Manila month's estimated spend reaches it, calls are refused (429) and logged as `OVER_BUDGET` | The Console cap is what actually stops billing; the app cap fails politely first. Two calls at the same moment can overshoot the soft cap by a call's cost, which is why the hard cap is set above it |
| D6 | Cost is estimated in USD from a price table in code (per million tokens, with cache read and write rates), per attempt at the model that ran it | Anthropic bills in USD; a peso figure would need an exchange rate |
| D7 | One shared `BASE_SYSTEM_PROMPT`: the Lydia's Lechon context, ₱ amounts, Manila time, "use only the figures given", reply in the user's language (English, Filipino or Taglish), English when there is no question | Keeps all seven features consistent |
| D8 | `stop_reason` is checked before content. The server-side refusal fallback is on (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`, via `client.beta.messages`) | Cheap insurance: a declined request is rerun on Anthropic's recommended model in the same call |
| D9 | SDK errors become a message and a status: rejected key 502, rate limit 429, overloaded / server / unreachable / timeout 503, any other API error 502. The API's own message is stored in `errorType` | An admin sees "credit balance too low" or "invalid x-api-key" on AI Settings without reading server logs |
| D10 | AI Settings page (ADMIN) with a Test connection button (`POST /api/ai/test`) | Proves the integration end to end in the browser, and gives a place to watch AI spend from Week 9 on |
| Answers | "do all recommended"; model Sonnet 5.5; key and Console setup postponed by the owner | — |

## What changed

- *1.1 AI Settings page.*
  - `@anthropic-ai/sdk` 1.9.0. It added no `npm audit` findings.
  - `lib/claude.ts` (new):
    - `AI_MODEL` and `AI_FEATURES`, typed `Record<AiFeature, …>`, so a new enum value without settings fails the typecheck.
    - `MODEL_PRICES` for Sonnet 5.5 and Sonnet 5 (the fallback).
    - `isAiConfigured()` and `getClaude()`: built on first use, `null` without a key. A module variable, not
      `globalThis`, since the SDK client holds no sockets.
  - `lib/config.ts`: `anthropicApiKey` (optional) and `aiMonthlyBudgetUsd`. A malformed budget fails at startup like
    a missing required variable.
  - `lib/format.ts`: `formatUsd` — 2 places for totals, 4 for one call.
  - `lib/navigation.ts`: Admin → AI Settings. `.env.example` documents both variables.
- *1.2 `AiCall` table, real spend.*
  - Migration `20261118090000_ai_calls`.
  - `AiCallRepository`: `record`, `spendSince`, `spendByFeatureSince`, `findLatest`. Postgres does the totals.
  - `AiService.overview()`: this Manila month's spend, the % of budget (100 once used up, or when the budget is 0),
    per-feature calls and spend, the latest 20 calls as DTOs.
  - The page shows them. The bar is orange, amber from 80 %, red at 100 % with "AI features are paused until next
    month". `components/ai/RecentAiCalls.tsx` shows "answered by …" on fallback rows, "Background job" when no user
    asked, and cache tokens when there are any.
- *1.3 `AiService.complete()`.*
  - The order: no key → 503, nothing recorded. Budget used up → `OVER_BUDGET` row and 429, no request sent. Then
    `client.beta.messages.create(…).withResponse()` with adaptive thinking, the feature's effort and max tokens,
    base prompt + the feature's instructions, and the fallback.
  - Outcomes: `refusal` → `REFUSED` (400, with the category in `errorType`); `max_tokens` → `MAX_TOKENS` (502 — the
    answer is incomplete); otherwise `COMPLETED`, returning the text, the model that answered, tokens, cost and time.
  - `estimateUsage()` (exported for the streaming assistant) prices each entry of `usage.iterations` at its own
    model. A model missing from the price table is priced at the requested model's rates with a warning; if neither
    is priced it throws, so the budget can never silently count a call as free.
  - `describeApiError()` checks the SDK error classes most specific first (a timeout is a connection error, a 529 is
    a server error) and writes labels out by hand, since a minified build can rename classes. Anything not from the
    SDK is rethrown for the route's `catch`.
- *1.4 Test connection.*
  - `AiService.testConnection(message, userId)` and `POST /api/ai/test` (zod: 1–500 characters; the user from
    `x-user-id`), with its own ADMIN guard in `middleware.ts`.
  - `components/ai/TestConnection.tsx`: an editable message, in Filipino by default to check the language rule. It
    shows the reply with an AI label, model, tokens, cost and time, and refreshes the page so the call appears in
    the list.
- *1.5 Docs.* This note; `progress.md`; `database.md`, `api.md`, `architecture.md`, `overview.md`; the roadmap.

## Database

Migration `20261118090000_ai_calls`, additive only:
- Enums `AiFeature` (`CONNECTION_TEST`) and `AiCallOutcome` (`COMPLETED`, `REFUSED`, `MAX_TOKENS`, `ERROR`,
  `OVER_BUDGET`).
- Table `AiCall`:
  - `feature`, `outcome`, `model`, `servedModel?`, `userId?`
  - `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`
  - `costUsd` (Decimal), `durationMs`, `requestId?`, `errorType?`, `createdAt`
- Index `AiCall(createdAt)`. FK `userId → User` `ON DELETE SET NULL`, so a call's cost survives if its user is removed.

Each later feature adds its `AiFeature` value in its own migration.

## API

`POST /api/ai/test` — ADMIN. Body `{ message }`, 1–500 characters after trimming.
- 200 `{ completion: { text, servedModel, inputTokens, outputTokens, costUsd, durationMs } }`
- 400 validation, or Claude declined (refusal)
- 429 budget used up, or rate limited
- 502 key rejected, answer cut off, or another API error
- 503 not set up, unreachable, overloaded or timed out

## UI

- Admin → **AI Settings** (`/admin/ai`, ADMIN only).
- No other page changes. AI features add their own UI in later tasks.

## Configuration

Both optional, in `.env` (documented in `.env.example`):
- `ANTHROPIC_API_KEY`: a key from a dedicated Console workspace with its own spend limit.
- `AI_MONTHLY_BUDGET_USD`: default `20`; dollars with up to 2 decimals, anything else stops the app at startup.

Restart `npm run dev` and `npm run worker` after changing either. CI needs neither.

## How to verify

Without a key (free):
- AI Settings shows "Not set up". Test connection answers "AI is not set up yet".
- Non-admin roles are redirected from `/admin/ai` and `POST /api/ai/test`.

With a key (well under $0.01 per test):
- Test connection with the Filipino default gets a reply in Filipino; an English question, a reply in English.
- Spending and Latest calls go up by that call's cost.

What was checked:
- `estimateUsage` against hand-worked figures: plain call, declined attempt + fallback, empty cache fields,
  unpriced model.
- `complete()`: no key → 503, nothing recorded. Budget used up → `OVER_BUDGET`, no request. Fake key against the
  real API → `ERROR` "AuthenticationError: invalid x-api-key" with Anthropic's request id. Unreachable host →
  `ERROR` "ConnectionError" after the SDK's retries.
- `POST /api/ai/test`: per role, and the validation errors.
- `tsc`, lint, `prisma validate`, no migration drift.

## Risks, assumptions, follow-ups

- **Not yet run against a real key.** The owner postponed buying API credits. A successful answer, a refusal with
  fallback and a cut-off answer have not been seen live; the first Test connection with a real key closes that.
- The **API subscription is separate** from a claude.ai Pro/Max subscription: the API needs Console credits.
- **Prices are in code** (`MODEL_PRICES`). They need updating when Anthropic changes them or a model is added.
  Costs are estimates; the Console's billing is the truth.
- The soft budget can overshoot by about one call when calls run at the same moment. The Console limit is the hard
  stop.
- Business data — costs, item and supplier names — will be sent to Anthropic by the features that need it. API data
  is not used for training by default.
- `complete()` is non-streaming, for answers of a few thousand tokens. The assistant (Feature 2) adds streaming and
  reuses `estimateUsage` and the error mapping. Prompt caching is per feature, once a feature's prompt is long enough
  to qualify.
- No per-user rate limit yet. The budget bounds the cost; the assistant may need one.
