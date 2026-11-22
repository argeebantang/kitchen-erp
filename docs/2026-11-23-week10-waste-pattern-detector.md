# 2026-11-23 — Waste Pattern Detector, AI badge and Regenerate (Week 10, Task 2)

Week 10 roadmap task "FEATURE 3 — Waste Pattern Detector: BullMQ weekly job that sends last 30 days of write-off data
to Claude. Claude identifies patterns per branch per item and writes actionable recommendations. Shown on head office
dashboard." It also builds the week's shared pieces: "All AI features are clearly labeled with an AI badge" and "Each
insight has a Regenerate button", applied here to Feature 1 and Feature 3. Task 7 sweeps the rest.

It builds on Week 9's AI foundation (`AiService`, `AiCall`, `AiInsight`, the `ai` queue) and on the history data of
Task 1 (`docs/2026-11-22-week10-history-data.md`), whose built-in patterns are its answer key.

What it gives:
- **Dashboard → KitchenAI insights → Waste — last 30 days.** Seen by ADMIN, ACCOUNTING, PRODUCTION_MANAGER and VIEWER.
  - **The figures, worked out by the system:** what was lost (written off + lost in transit) against what was produced,
    and the change on the 30 days before.
  - **A table of the costliest branch-and-good pairs:** kg and ₱ written off, why, on how many days, the waste rate,
    sold against received for outlets, the change against the previous 30 days. Below it, routes that lost goods in
    transit, and conversions (recovered).
  - **Claude's findings** (AI badge): a summary and up to 5 patterns, each with a priority, the pattern, what to do this
    week and who does it, and the rows it rests on (W4, T1…), shown beside it so the text can be checked.
- **Every Monday at 06:00** the report for the week is written by itself. **Generate this week's report** and
  **Regenerate** are on the card too.
- **Regenerate on every insight:** the earlier text stays on screen, dimmed, while a new one is written. If writing it
  fails, the earlier one comes back with the reason. The cost explanation on production orders has it now.

Built in subtasks 2.1–2.5 (2.2 and 2.3 together). Steps are in `docs/week10-task2-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| P1 | **Code computes, Claude explains.** `WastePatternService.facts` works out every figure; Postgres sums in Decimal. Claude is told never to calculate and to quote figures as given | Feature 1's rule. Checked: every number in three reports was in the facts |
| P2 | **Regenerate keeps the old text.** `AiInsightRepository.regenerate` moves READY → PENDING keeping content, facts and call. A failed attempt after it goes back to READY with the earlier text and the reason in `error`. A first attempt still ends FAILED | The page never goes blank. `AiCall` keeps the cost history of every version |
| P3 | **One report per ISO week:** insight (`WASTE_PATTERN`, `'Week'`, `'2026-W48'`), covering the 30 days before that week's Monday. Earlier weeks stay as their own rows; Regenerate rewrites only that week | The window is fixed by the key, so a Regenerate sees the same figures. History of reports comes free |
| P6 | **One endpoint for every insight:** `POST /api/ai/insights { type, referenceId, regenerate? }`. `AiInsightService` is a registry per type (who may ask, how). It replaces `/api/ai/cost-variance` | One button and one rule for all seven features |
| P7 | **Clock jobs on the `ai` queue:** `AI_SCHEDULED_JOBS` (`waste-pattern-weekly`, Mondays 06:00 Manila), registered with the same `upsertJobScheduler` as `DAILY_JOBS`. `npm run job` runs either kind | Same mechanism, on the queue a report belongs to |
| F3-1 | **What counts:** write-offs (lost, by reason) and losses in transit (lost) are added into "Lost". Returns and conversions are shown as recovered, not lost. Written off and lost in transit never overlap: goods lost on the road never reach the outlet's stock | Owner: waste happens at outlets and kitchens. A write-off and a transit loss are different records (WO vs the delivery's variance) |
| F3-2 | **Structured output:** `AiService.complete` takes an optional JSON schema (`output_config.format`). Claude returns `{ summary, findings[] }`, each finding `{ figureIds, title, pattern, recommendation, priority }`. The service keeps at most 5 and drops a finding whose ids name no row | Always parseable, laid out on the page, each finding tied to its figures. Works with thinking and the refusal fallback |
| F3-3 | **Rows given to Claude:** the 12 costliest branch-and-good pairs (W1…), routes with losses (T1…), conversions per kitchen (C1…). Daily averages are in the facts, so a recommendation can use one ("order closer to its 4.38 kg average daily sold") without calculating | Enough for patterns. A quantity in a recommendation must still be a given figure |
| F3-4 | **Prompt:** one finding per distinct problem; the same problem at several branches is one finding | A version spent 3 of 5 findings on Lechon (one per kitchen) and missed Alabang's over-ordering; grouping fixed it |
| F3-5 | **Who:** sees it — ADMIN, ACCOUNTING, PRODUCTION_MANAGER, VIEWER. Generates / regenerates — ADMIN, ACCOUNTING, PRODUCTION_MANAGER. Branch managers: not yet (it would need filtering to their outlet) | Owner, 2026-11-21. Reading is free; writing costs |
| F3-6 | **Model and effort:** Sonnet 5.5 (D3), effort `low`, max tokens 8,000. A quiet month with no waste is written without calling Claude | Low effort found every built-in pattern. Measured about $0.023 a report |

## What changed

- *2.1 Shared AI pieces, on Feature 1.*
  - `repositories/ai-insight.repository.ts`: `regenerate`; `fail` is regenerate-aware.
  - `services/ai.service.ts`: `AiInsightDto.regenerating`.
  - `services/ai-insight.service.ts` (new): the registry, `canGenerate`, `request`.
  - `app/api/ai/insights/route.ts` (new); `app/api/ai/cost-variance` removed; its middleware guard is replaced by
    `/api/ai/insights`.
  - `components/ai/AiBadge.tsx`, `InsightRequestButton.tsx`, `AiInsightPanel.tsx` (new), the last covering every state:
    none, writing, failed, written, regenerating, regenerate failed. `components/production/ExplainBatchButton.tsx`
    removed.
  - `CostVarianceCard` uses the panel; the order page passes `canExplain`. `CostVarianceService.request` takes
    `{ regenerate }`.
- *2.2–2.3 The detector.*
  - `repositories/waste-report.repository.ts` (new): write-offs by branch, good and reason; days with write-offs; what
    came in and was returned; sold; routes; conversions; production cost.
  - `services/waste-pattern.service.ts` (new): `facts`, `request`, `write`, `giveUp`, `dashboard`, `parseReport`.
  - `lib/dates.ts`: `isoWeekKey`, `weekKeyStart`, `WEEK_KEY_PATTERN`.
  - `lib/claude.ts`: `AI_FEATURES.WASTE_PATTERN`.
  - `services/ai.service.ts`: `format` on `complete()` / `round()`.
  - `lib/queue.ts`: `WASTE_PATTERN_REPORT`, `WastePatternJob`.
  - `worker/index.ts`: the report job, and give-up for it.
  - `components/ai/WasteReportCard.tsx` (new), on `app/(protected)/dashboard/page.tsx` with `AutoRefresh` while it is
    written.
- *2.4 Weekly job.*
  - `lib/queue.ts`: `WASTE_PATTERN_WEEKLY`, `AI_SCHEDULED_JOBS`.
  - `worker/index.ts`: registers both lists, and runs the weekly job.
  - `scripts/run-job.ts`: AI jobs too.

## Database

Migration `20261123090000_ai_waste_pattern`, additive: `AiFeature` and `AiInsightType` gain `WASTE_PATTERN`. Reports
are `AiInsight` rows with `referenceType 'Week'` and `content` the findings as JSON. Still 35 models.

## API

- **New** `POST /api/ai/insights` — body `{ type: 'COST_VARIANCE' | 'WASTE_PATTERN', referenceId, regenerate? }`.
  `referenceId` is a production order id, or an ISO week such as `2026-W48`.
  - 200 `{ queued: true }`; 200 `{ queued: false }` when one is already being written, or written (without
    `regenerate`), or not READY (with `regenerate`): nothing spent.
  - 400 unknown type, unknown week, a week not started; 403 the type's roles; 404 unknown order; 409 an order not
    completed and costed.
  - Guard: ADMIN, ACCOUNTING, PRODUCTION_MANAGER.
- **Removed** `POST /api/ai/cost-variance` (same body as `{ type: 'COST_VARIANCE', referenceId }`).

## UI

- Dashboard: **KitchenAI insights → Waste** (described above).
- Production order → "Why this batch cost what it did": the AI badge, Regenerate, and the regenerating / regenerate
  failed states.
- AI Settings lists the new feature as "Waste pattern detector". The Monday job's calls show "Background job".

## Configuration

None new. After pulling: `npx prisma migrate dev`, then restart `npm run dev` and `npm run worker`. A running
`tsx watch` worker did not pick up the new job here, and failed it with "Unknown job name" until restarted.

## How to test

1. As Maria, open the Dashboard → Waste — last 30 days.
   - The totals: Lost ₱67,791.75, 6.6 % of production; Written off ₱62,839.06; Lost in transit ₱4,952.69.
   - The findings, each with its rows.
2. **Regenerate**: the earlier text is dimmed, then a new one in about 10 s.
3. As Ana Viewer: the same card, no Regenerate. As Pedro: no section.
4. `npm run job -- waste-pattern-weekly`: "already asked for" while this week's report exists.
5. Production order PRD-000549 → the explanation's Regenerate.

What Claude checked (2026-11-23):
- **Totals:** re-summed independently in SQL — ₱62,839.06 / 201.73 kg / 100 write-offs; ₱4,952.69 in transit — equal to
  the facts.
- **Every pattern from Task 1's answer key was found:** the kitchens' Lechon, Las Piñas Bopis failing quality, Alabang
  ordering more Dinuguan than it sells, Pasig → Makati losses.
- **No invented numbers:** every number in the findings (61–63 per report) is in the facts.
- **Cost:** 4 reports, about $0.023 each, 9–10 s.
- **Endpoint refusals:**
  - viewer → redirect
  - a week not started → 400
  - a malformed week → 400
  - asking again while written → no call
  - two Regenerates at once → one call
- **Feature 1 on the new endpoint:** an explanation written in about 6 s for $0.006, regenerated by the user who
  clicked. A failed regenerate keeps the earlier text and shows why. Unknown order 404.
- **Weekly job:** with a report already there it spends nothing. With none, it queued the report, which was written as
  a background call.
- **Checks:** `tsc`, `eslint`, no schema drift.

## Follow-up (2026-11-23): waste per branch

Owner: "there is no write offs or waste per branch?" The card showed waste per branch *and good* (W rows), but no total
per branch, so which branch wastes the most was not visible at a glance.

- `WastePatternService.facts` adds `branches` (B1…, the costliest first): one row per branch over **all** its
  write-offs, not only the top 12 pairs. Each row has the number of write-offs, kg and ₱, its share of everything
  written off, the waste as a % of what came in (all goods), and the good it wasted most of.
- The card's figures start with a **By branch** table; findings can cite B rows.
- Claude is told about B rows, and the summary names the branch where most of the waste is.

Checked: the six branch totals equal an independent SQL sum per branch (count, kg, ₱). For 2026-W48, Las Piñas
Commissary has ₱22,475.59 (35.8 %), Pasig ₱18,259.55, Main ₱14,566.45, Alabang ₱3,646.99, Cubao ₱2,202.98 and Makati
₱1,687.49. A regenerated report led with Las Piñas and Pasig, and all 50 numbers it quoted are in the facts ($0.023).

## Risks, assumptions, follow-ups

- **The findings are Claude's.** The figures beside each one are the check. A Regenerate can word, group and order them
  differently. Figures never change for the same week.
- **Only the current week is shown.** Earlier weeks' reports are kept (one row per week) but have no page yet. A week
  picker can come with Task 7's sweep.
- **Patterns in the history are designed.** Real data will be noisier; the "leave out one-off losses" rule may need
  tuning then.
- **Branch managers do not see the report.** A per-outlet view needs the facts filtered to their branch.
- **Insight states are per week**, so a job that fails on Monday morning leaves "Try again" on the card for that week.
