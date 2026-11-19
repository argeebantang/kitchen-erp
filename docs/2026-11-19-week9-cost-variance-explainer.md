# 2026-11-19 — Cost Variance Explainer (Week 9, Task 2)

Week 9 roadmap task "FEATURE 1 — Cost Variance Explainer: after every production order closes, Claude
auto-generates a plain-language explanation of why the cost was higher or lower than last batch. Stored in DB,
shown on production order detail page." It is the first AI feature on the Task 1 foundation
(`docs/2026-11-18-week9-claude-api-integration.md`).

What it gives:
- **A card on every completed production order**, "Why this batch cost what it did", placed under Costing:
  - the cost per kg, with the change against the previous batch of the same good (₱ and %)
  - that change split into **ingredient prices** and **usage and yield**
  - the yields side by side, and whether the recipe version changed
  - every ingredient's part in the change, the biggest first
  - **Claude's explanation** of those figures in a few sentences
- **Automatic**: accounting's approval of a completion queues the explanation, and a background job writes it.
  Seconds later it appears on the page without a reload.
- **On demand**: "Explain this batch" when there is none, and "Try again" after a failure.
- **Stored**: the new `AiInsight` table (the plan's `ai_insights`) keeps the text together with the exact figures and
  prompt it was written from. It is built to be reused by Features 3, 4 and 6.

Built in subtasks 2.1–2.6. Steps are in `docs/week9-task2-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| E1 | "Last batch" = the previous **completed** run of the same finished good at any branch, ordered by production date (the lot's `producedOn`), then by approval time. A good's first batch is compared with its own plan | Production is at the commissary, so "same branch only" would rarely differ. A first batch still gets a useful comparison |
| E2 | **Code calculates, Claude explains.** Every figure is exact Decimal arithmetic in `CostVarianceService`. Claude gets the figures already rounded and is told to quote them, not recalculate | LLMs are unreliable at arithmetic, and accounting needs exact pesos. The card shows the figures itself, so the text can be checked against them |
| E3 | New table `AiInsight`, generic: `type` + `referenceType` + `referenceId` (unique), `status` PENDING / READY / FAILED, `content`, `facts` (the JSON sent), `prompt`, `model`, `aiCallId → AiCall`, `error`, `generatedAt`. One per (type, record), updated in place. `AiFeature` gains `COST_VARIANCE`. Models 30 → 31 | Reusable for Week 10's features. With facts and prompt stored, the AI's input can be audited |
| E4 | After the completion approval commits, queue `cost-variance-explain` on a new **`ai` queue**, consumed by a second BullMQ worker (2 at a time). 3 attempts with exponential backoff (30 s, 60 s), used only for recoverable failures (rate limit, overloaded, unreachable). Not set up / over budget / refused / cut off → FAILED straight away | A slow AI call never delays approvals or notifications. Retrying a permanent failure would only spend money |
| E5 | The card sits on the order page, visible to everyone who can open the order. States: none ("Explain this batch"), generating (spinner, page re-checks every 5 s), failed (reason + "Try again"), ready (text + when, model, cost, "Check it against the figures above") | The roadmap: "shown on production order detail page". Regenerating a ready explanation waits for Week 10 |
| E6 | `POST /api/ai/cost-variance { productionOrderId }` for ADMIN, PRODUCTION_MANAGER and ACCOUNTING. It queues the same job | `/api/production-orders` excludes accounting, the card's main readers |
| E7 | Prompt: English, 3–5 sentences under 110 words, plain text, at most two ingredients named. It leads with the change and what it is compared with, then the main cause in ₱/kg and the yields, and adds one practical note only if the figures support it. Effort `low`, max tokens 2,000 | Owner accepted English. A real explanation costs $0.005–$0.008 |
| E8 | No notification | Accepted. An alert on large jumps is a possible follow-up |
| E9 | Test data goes through the real flow (create → submit → approve → start → report done → approve completion): Bopis runs at Main Commissary with a price change and different yields, notes `claude test …` | No completed runs remained after the Week 8 cleanup |
| Answers | "next" = all recommended. $5 credits and a 90-day dev key in `.env`, `AI_MONTHLY_BUDGET_USD=4` | — |

## What changed

- *2.1 The comparison (no AI).*
  - `ProductionOrderRepository.findForCostComparison(id)` and `findPreviousCompleted(finishedGoodId, …)`.
    "Previous" is decided on (`lot.producedOn`, `completedAt`), so two runs on the same day compare in approval order.
  - `services/cost-variance.service.ts` (new), `comparison(orderId)`. The ingredients are the order's own ledger rows
    (`StockMovement` by reference) at the unit cost recorded at approval, not today's prices. Per ingredient, per kg
    of output: quantity, price, cost. The change splits exactly into
    `(price now − price then) × quantity now + (quantity now − quantity then) × price then`. Lower yield shows up as
    more of every ingredient per kg. Against the plan (first batch): price effect
    `(actual − planned cost) ÷ planned qty`, yield effect = the rest.
  - `components/production/CostVarianceCard.tsx` (new, Server Component) on the order page, completed orders only.
- *2.2 `AiInsight`.*
  - Migration `20261118150000_ai_insights`.
  - `repositories/ai-insight.repository.ts` (new): `find`, `request` (FAILED → PENDING, or insert with
    `ON CONFLICT DO NOTHING`; false when one is already PENDING or READY), `complete` (PENDING → READY), `fail`
    (PENDING → FAILED). Every status move has the expected status in the `WHERE`.
  - `lib/claude.ts`: `AI_FEATURES.COST_VARIANCE`. `AiService.toInsightDto()`: dates and cost as strings, for the card.
- *2.3 The explainer.*
  - `CostVarianceService.explain(orderId, { userId, lastAttempt })`:
    - It acts only on a PENDING insight; anything else is `SKIPPED` with no call.
    - The figures go in as JSON inside `<figures>`: rounded like the card (₱ to the centavo, % to 1 place), with the
      6 ingredients that moved most.
    - The result is READY, FAILED, or `RETRY` (recoverable and not the last attempt).
  - `AiService.complete()` now says whether a failure is `retryable` and returns the `AiCall` id (`callId`).
    `AiCallRepository.record` returns the id.
- *2.4 Automatic run.*
  - `lib/queue.ts`: `AI_QUEUE` (`ai`), `COST_VARIANCE_EXPLAIN`, `AI_JOB_OPTIONS`, `CostVarianceJob`, a lazy
    `getAiQueue()`.
  - `CostVarianceService.request()`: checks the run is completed and costed, marks the insight PENDING, queues the
    job. If queueing fails, the insight is marked FAILED ("the job queue is unavailable") so it doesn't stay PENDING.
  - `ProductionOrderService`: an approved completion calls `request(id, null)` after its commit and its
    notification, in its own try/catch, so it can never fail the approval.
  - `worker/index.ts`: a second `Worker` on `ai` (concurrency 2). `RETRY` throws so BullMQ retries. If a job dies of
    an unexpected error on its last attempt, the insight is marked FAILED. Shutdown closes both workers and queues.
  - The order page includes `AutoRefresh` (5 s) only while the explanation is PENDING.
- *2.5 Explain / Try again.*
  - `app/api/ai/cost-variance/route.ts` (new) and its guard in `middleware.ts`.
  - `components/production/ExplainBatchButton.tsx` (new, Client Component): POST, then `router.refresh()`.
  - `request()` answers 404 for an unknown order.
- *2.6 Docs.* This note; `progress.md`; `database.md`, `api.md`, `architecture.md`, `overview.md`; the roadmap.
- Also: `.env.example`'s `AI_MONTHLY_BUDGET_USD` example is back to `"20"`. Task 1 committed a local test value.

## Database

Migration `20261118150000_ai_insights`, additive only:
- Enums `AiInsightType` (`COST_VARIANCE`) and `AiInsightStatus` (`PENDING`, `READY`, `FAILED`).
- `AiFeature` gains `COST_VARIANCE`. `ALTER TYPE … ADD VALUE` is safe in the migration's transaction because the
  migration does not use the value.
- Table `AiInsight`:
  - `type`, `referenceType`, `referenceId`, `status` (default PENDING)
  - `content?`, `facts` (JSONB)?, `prompt?`, `model?`, `aiCallId?`, `error?`, `generatedAt?`
  - `createdAt`, `updatedAt`
- `@@unique(type, referenceType, referenceId)`, which is also the lookup index.
- FK `aiCallId → AiCall` `ON DELETE SET NULL`.

31 models. No existing data touched.

## API

`POST /api/ai/cost-variance` — ADMIN, PRODUCTION_MANAGER, ACCOUNTING. Body `{ productionOrderId }` (cuid).
- 200 `{ queued: true }`: the explanation is now PENDING and the job is queued.
- 200 `{ queued: false }`: one is already PENDING or READY, so nothing was queued and nothing was spent.
- 400 validation · 404 order not found · 409 not a completed order with a recorded cost.
- AI errors (not set up, over budget, …) do not come back here. The job records them on the insight, and the card
  shows them with "Try again".

## UI

- Production order detail (completed orders): the "Why this batch cost what it did" card, described above.
- No other page changes. The calls appear on Admin → AI Settings as "Cost variance explainer". Automatic ones show
  "Background job"; button clicks show who clicked.

## Configuration

None new. Restart `npm run worker` to run the new `ai` worker, and `npm run dev` for the regenerated Prisma client.
Without `ANTHROPIC_API_KEY`, explanations end FAILED "AI is not set up yet" and the figures still show.

## How to verify

1. Complete a production run and approve the completion as accounting. Open the order: the card shows the figures,
   a spinner, then the explanation within about 10 s.
2. Check every figure in the explanation against the card.
3. A completed order with no explanation shows "Explain this batch"; a failed one shows "Try again". Both lead to
   the spinner, then the text.
4. AI Settings → recent calls: one "Cost variance explainer" call per explanation, under $0.01.

What was checked:
- The cost split by hand: e.g. Pork Lungs ₱180 → ₱205/kg = +₱9.68/kg from price. The parts add up to the total with
  no remainder.
- `explain()` with no money spent: READY → `SKIPPED`; unreachable host → `RETRY`, then FAILED on the last attempt;
  no key → FAILED; a draft → FAILED.
- Five real explanations (higher price, lower yield, better yield, first batch). Every figure quoted was one given.
- Automatic: approval → PENDING → READY in about 3 s, on the first attempt, as a background call.
- The endpoint: viewer / branch / procurement / logged out refused; 400 / 404 / 409; asking again for a READY
  explanation queued nothing (no `AiCall` added); a simulated FAILED → Try again → READY, recorded against the
  user who clicked; a double click queued once.
- `tsc`, lint, no migration drift.

## Risks, assumptions, follow-ups

- **The text is Claude's.** It is told to quote only the given figures, and the card's own figures sit right above
  it. The footer says to check one against the other.
- Each explanation sends that batch's costs and ingredient names to Anthropic (see Task 1's risks; API data is not used for training by default).
- If the worker is down, explanations stay PENDING (spinner) until it is back. The job is in Redis and runs then.
- If an older run is approved after a newer one, the newer run's explanation is not rewritten.
  "Previous" is by production date, so the stored text may name a different batch from what the card now shows.
  Regenerating a READY explanation is a Week 10 follow-up.
- `findPreviousCompleted` filters `ProductionOrder` by `finishedGoodId` without its own index. That's fine at the
  current volume. Add `(finishedGoodId, status)` if order history grows large.
- Possible follow-ups: notify on large jumps (E8); regenerate; Filipino explanations if the owner wants them.
