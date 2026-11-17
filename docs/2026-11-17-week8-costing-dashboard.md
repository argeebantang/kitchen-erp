# 2026-11-17 — Costing dashboard (Week 8, Task 6)

Week 8 roadmap task "COSTING DASHBOARD: cost per finished good over time, most expensive batches, write-off cost
impact per week, weekly cost trend chart". It completes Week 8.

**Costing → Costing Dashboard** (`/costing`) shows management, week by week:
- what production cost
- what each finished good cost per kg
- which batches cost the most
- what was lost to write-offs and short transfers

Every figure is a cost already recorded at sign-off (Weeks 6–8). Nothing is recomputed and nothing is stored.

Built in subtasks 6.1–6.5.
- Test data was prepared on 2026-11-17 and kept for the user until the end of the task:
  - 18 batches, 5 conversions, 8 write-offs
  - 4 transfers to a "CT Outlet" test branch
  - 1 run awaiting completion approval
  - all with notes `claude test costing`
- Steps are in `docs/week8-task6-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| C1 | A new page `/costing`, under a new sidebar group Costing | `/dashboard` is every role's landing page; this is a management view. |
| C2 | ADMIN, ACCOUNTING, PRODUCTION_MANAGER, VIEWER. Others are sent to "Access denied" by the middleware, as every other role-guarded page does | Management view. |
| C3 | Weeks run Monday to Sunday, Asia/Manila | — |
| C4 | A figure belongs to the week it happened and counts once signed off: a run or conversion by its lot's production date, a write-off by the day it was recorded, a transfer shortfall by the day it was received. A note counts what in the range is still awaiting approval | A batch cooked Sunday and approved Monday stays in its own week. The cost: a past week can still change until its items are approved, which the note makes visible. |
| C5 | The last 12 weeks including the current one; `?weeks=` 4 / 12 / 26 / 52 | Readable chart, visible trend. |
| C6 | Tiles, this week against last: production cost, batches completed, lost, lost as % of production cost | The roadmap deliverable at a glance. |
| C7 | A weekly production-cost chart (batches, conversion ingredients) and a lost chart (write-offs, transfer shortfall) on the same weeks, plus a weekly table. Server-rendered SVG | No new dependency, no client JavaScript. |
| C8 | Cost per unit of each good per week, weighted (Σ cost ÷ Σ made), conversion output included; a week without output is a gap. **Refined while building:** one small chart per good on its own scale, not four lines on one axis | On one ₱130–₱440 axis, Bopis's ₱130 → ₱136 would be a flat line. |
| C9 | The 10 most expensive batches in the range by total cost, with cost per unit and variance vs plan; order links via `SOURCE_PAGES` | — |
| C10 | Write-off impact per week: by reason, plus transfer shortfall, total lost and % of production cost | "% of cost" makes the figure meaningful. |
| C11 | Transfer shortfall (`StockTransfer.varianceValue`) counted as a loss, in its own column | As agreed in Task 4. |
| C12 | No branch filter | Production runs at the commissary; a follow-up. |
| C13 | Read the signed-off records in the range and total them in the service with `Prisma.Decimal`; nothing stored | A few rows a day. Aggregating in SQL is the follow-up if it ever gets slow. |
| C14 | Not live | Figures change only at sign-off. |
| Answers | "do all recommended" | — |

## What changed

- *6.1 Page, range, tiles.*
  - `services/costing.service.ts` (new): `CostingService.dashboard(range, viewer)` builds one bucket per week and adds up
    each record in its week.
  - Read methods, one per repository:
    - `ProductionOrderRepository.findCompletedProducedBetween`
    - `ConversionOrderRepository.findApprovedProducedBetween`
    - `WriteOffRepository.findApprovedRecordedBetween`
    - `StockTransferRepository.findReceivedShortBetween`
  - Lots are dated by label (UTC midnight), so they are bounded by date labels. Write-offs and receipts are moments,
    bounded by Manila midnights (`businessDayRange`).
  - `lib/dates.ts`: `weekStartOf` (the Monday) and `shortDateLabel` ("Nov 10").
  - Page `app/(protected)/costing/page.tsx`, `components/costing/CostingHeadline.tsx`, a `/costing` guard in
    `middleware.ts`, and the sidebar group.
- *6.2 Weekly charts and table.*
  - `components/costing/WeeklyColumnChart.tsx` draws stacked columns as SVG on the server:
    - clean axis ticks
    - 4 px rounded tops, and a 2 px gap between stacked parts
    - value labels only on the tallest week and this week, and only when a column has room
    - week labels thinned past 13 weeks and kept inside the edges
    - a week's figures on hover (`<title>`)
    - a non-zero part is never thinner than 2 px
  - `chart-colors.ts` gives one colour per figure. The four colours passed the dataviz palette check for colour-blind
    separation. Two are faint on white, so every figure is also in a table.
  - `WeeklyCostTable.tsx` lists the weeks newest first, with a total row for the range (`totals` from the service).
- *6.3 Cost per finished good.*
  - The service returns `goods`: per good, per week, Σ cost and Σ made → cost per unit.
    - Batches cost their `actualCost` for `actualQty`.
    - Conversion output costs `sourceCost + conversionCost` for `outputQty`, the same as its lot's cost.
  - Each good also gets its range average, the first and latest week it was made, and the change between them.
  - `components/costing/CostPerGood.tsx`: one card per good with a line chart on its own scale. The header has the
    latest cost per unit and the change (▲ red = dearer). A folded table lists every week.
- *6.4 Most expensive batches.*
  - The service ranks the range's signed-off runs by `actualCost`, top 10, linking each to its order for roles in
    `SOURCE_PAGES.ProductionOrder`.
  - It counts what is still awaiting approval in the range, for the amber note:
    - `countAwaitingCompletionBetween` (by `completedAt`)
    - `countPendingRecordedBetween` on conversions and write-offs
  - `components/costing/ExpensiveBatches.tsx`.
- *6.5* This note, the reference docs and the roadmap (Week 8 done, Week 9 next).

## Files affected

- `services/costing.service.ts` (new)
- `repositories/production-order.repository.ts`, `repositories/conversion-order.repository.ts`,
  `repositories/write-off.repository.ts`, `repositories/stock-transfer.repository.ts`
- `app/(protected)/costing/page.tsx` (new)
- `components/costing/CostingHeadline.tsx`, `WeeklyColumnChart.tsx`, `WeeklyCostTable.tsx`, `CostPerGood.tsx`,
  `ExpensiveBatches.tsx`, `chart-colors.ts` (all new)
- `lib/dates.ts`, `lib/navigation.ts`, `middleware.ts`
- `docs/api.md`, `docs/architecture.md`, `docs/overview.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

## Database changes

None. The model count stays 29. Reads only, over existing indexes and relations:
- `ProductionOrder` by status, with its lot's `producedOn`
- `ConversionOrder` by status, with its lot
- `WriteOff` by status and `createdAt`
- `StockTransfer` by status and `receivedAt`

## API changes

None. The page reads the service directly. `docs/api.md` has a short Costing section saying so.

## UI changes

- New sidebar group **Costing → Costing Dashboard**.
- `/costing` shows:
  - range buttons
  - the awaiting note
  - this week's tiles
  - two weekly charts and the weekly table
  - cost per finished good
  - the most expensive batches

## Configuration / environment

None. No new dependency, no Prisma client change, no worker change, no restart needed.

## How to verify

```bash
npx tsc --noEmit && npm run lint
```

1. As admin@, open Costing → Costing Dashboard. The tiles show this week and last; switch between 4 / 12 / 26 / 52
   weeks.
2. Compare a week's figures with the documents: production cost = Σ batch cost on the orders whose lot was produced
   that week + Σ conversion cost. Lost = Σ approved write-off cost recorded that week + Σ shortfall value of transfers
   received that week.
3. As procurement@ or branch@: no Costing group, and `/costing` goes to Access denied.

Run on 2026-11-17 against the test data:
- **Every week's figures** matched a hand calculation. This week: ₱10,010 + ₱230 = ₱10,240 produced; ₱1,025 + ₱209
  = ₱1,234 lost (12.1%). Last week: ₱11,158 and ₱980 (8.8%). 12-week totals: ₱104,130.00 produced, ₱4,814.81 lost
  (4.6%).
- **Edge cases:**
  - A batch produced on Sunday Nov 15 counts in the week of Nov 9.
  - The rejected write-off, the pending write-off and the transfer received in full count nowhere.
  - The pending run and write-off show in the note.
- **Cost per good:** Lechon ₱380 → ₱418/kg (+10%), Bopis average ₱5,304 ÷ 40 kg = ₱132.60, Paksiw for the week of
  Oct 19 = (8 × ₱392 + ₱350) ÷ 13 = ₱268.15.
- **Batches:** the top 10 matched a hand ranking; e.g. PRD-000012 is 38 kg × ₱392 = ₱14,896, and its variance
  38 × (392 − 385) = +₱266.
- **Access:** order links for admin, accounting and production, none for viewer. Procurement and branch are
  redirected.
- **Charts:** rendered to images at 4, 12, 26 and 52 weeks and checked by eye.

## Risks, assumptions, follow-up

- **Past weeks can change** when an item from them is approved late (C4). The note shows how many are pending.
- **Conversions:** production cost counts only the ingredients they added. The Lechon a conversion used was counted as
  a batch, so counting it again would double it.
- **Unvalued shortfalls:** a shortfall from a lot with no recorded cost adds nothing to the transfer loss. They are
  counted (`unvaluedShortTransfers`) but not yet shown; none exist since Week 6 gave every lot a cost.
- **Follow-ups:**
  - a branch filter (C12)
  - a sort toggle for the batches (by cost per unit or by variance)
  - aggregating in SQL if the range ever gets slow (C13)
  - raw-material write-offs, which don't exist yet (Week 7, W1)
