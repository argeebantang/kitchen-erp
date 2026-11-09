# 2026-11-09 — Production costing: batch cost, cost per kg, variance (Week 6, Task 3)

Week 6 roadmap tasks "COSTING: compute total batch cost = sum of (ingredient qty × unit price on
production date)", "COSTING: compute cost per kg = total cost ÷ actual yield" and "COSTING: planned
vs actual cost variance recorded".

Every production run is now costed:
- An **estimate** while the run is still to happen.
- The figures approving **would record** while its completion waits.
- The figures **recorded** at approval, never recalculated afterwards.

Finished-goods lots carry their cost per kg and value.

Built in subtasks 3.1–3.4, each verified with curl and SQL and tested by the user in the browser.
Tracker: `docs/week6-task3-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Price = the reference `ItemPrice` (`supplierId` null) in force on the date, through `findPricesAsOf`, the same lookup purchase requests and the BOM viewer use. A price effective at any time that day counts | The roadmap's rule. Purchase-cost methods (FIFO, running average) are not workable yet: one receipt exists and stock goes negative. |
| D2 | Planned cost is priced on the order's production date (`plannedDate`); the actual (batch) cost on the lot's production date (the day the kitchen reported it done). Both at the BOM quantities a completion deducts | Each figure on its own date; yield shows in cost per kg. |
| D3 | Batch cost = Σ qty × price; cost/kg = batch cost ÷ actual yield; planned cost/kg = planned cost ÷ planned qty; variance = batch cost − planned cost/kg × actual yield (positive = over plan) | "What this output cost vs what that much output should have cost": price changes and yield loss together. 10 kg planned at ₱190.55/kg, 9.6 kg made for ₱1905.50 → +₱76.22, the value of the 0.4 kg lost. |
| D4 | Recorded at approval, in the same transaction and the same `UPDATE` as the status: `ProductionOrder.plannedCost`, `actualCost`, `costPerUnit`, `costVariance`; each ingredient `OUT` row's `unitCost` = the price used; the lot's `IN` row's `unitCost` = cost/kg. Columns, not the roadmap's `production_actuals` table | Prices can be back-dated, so a cost derived later could move after accounting signed it off. The ledger shows values, and write-offs (Week 7) can cost a lot. One approval per order: a separate table would add a join with no audit gain. |
| D5 | A missing price on either date blocks approval (409, naming each material and date); the preview, the Costing card and the inbox say so first; rejecting still works | Accounting approves the cost too. A partial cost would be stored wrong for good. |
| D6 | Stored unrounded (Decimal), shown to the centavo | Unit costs are multipliers. |
| D7 | Costing card on the order page (estimate / recorded on approval / recorded, with a per-ingredient breakdown); a cost line in the approval preview; unit cost in the inbox's Production completions; unit cost and value on Finished Goods; prices and values on the Stock Ledger's production rows | Accounting sees what it approves; "₱X to make Y kg — ₱Z/kg" is on the page. |
| D8 | No backfill (nothing was completed); expiry stays as the last Week 6 task | — |

## What changed

- *3.1 Schema.* Four nullable `Decimal` columns on `ProductionOrder`; migration
  `20261109120000_production_costing`.
- *3.2 Calculation.*
  - `costRun()` in `production-order.service.ts`: the run's per-material quantities
    (`consumptionByMaterial`, the same as the stock deduction) at the reference prices in force on a
    date, in one query. It returns the DTO and the Decimals.
  - `costVariance()` implements D3. `costingFor()` chooses ESTIMATE, PENDING or RECORDED by status.
  - New `CostingCard`. The detail DTO gains `costing`.
- *3.3 Recorded at approval.*
  - `applyCompletionDecision()` prices the run on both dates, refuses a missing price (409), and
    passes the four figures and the unit prices to `decideCompletion()`. That function stores the
    figures with the status change and the unit costs on both ledgers.
  - `recordedCosting()` builds a completed order's card from the stored columns and the ledger's
    prices.
  - Cost line and missing-price warning in `CompletionReview`. Prices on `CompletionStock`. The
    "completion approved" notification ends "— it cost ₱X/kg".
  - New `formatSignedPeso` in `lib/format.ts`.
- *3.4 Elsewhere.* `listPendingCompletions()` adds the unit cost approving would record (Unit cost
  column, or "Price missing"). `FinishedGoodStockRepository.findLevels()` reads each lot's creating
  `IN` cost. `InventoryService.finishedGoodStock()` adds unit cost and value per lot, and a value per
  total. Finished Goods page columns and "worth ₱…".
- *Fix:* `formatPeso` rounded through `Number(value).toFixed(2)`, which rounds most half-centavos
  down (a binary float cannot hold 3726.975 exactly). It showed one draft's estimate one centavo low
  against SQL. It now rounds half up on the decimal digits. This affects every peso shown in the app,
  only ever by that centavo.

## Files affected

- `prisma/schema.prisma`, `prisma/migrations/20261109120000_production_costing/migration.sql` (new)
- `services/production-order.service.ts`, `services/inventory.service.ts`, `services/notification.service.ts`
- `repositories/production-order.repository.ts`, `repositories/finished-good-stock.repository.ts`
- `components/production/CostingCard.tsx` (new), `components/production/CompletionReview.tsx`, `components/production/CompletionStock.tsx`
- `app/(protected)/production/orders/[id]/page.tsx`, `app/(protected)/procurement/approvals/page.tsx`, `app/(protected)/inventory/finished-goods/page.tsx`
- `lib/format.ts`
- `docs/api.md`, `docs/architecture.md`, `docs/database.md`, `docs/overview.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

## Database changes

Migration `20261109120000_production_costing`: four nullable columns, no backfill. After applying
it: `npx prisma generate`, restart `npm run dev` and `npm run worker`, and in VS Code "TypeScript:
Restart TS Server".

Data: production `OUT` rows and lot `IN` rows now carry `unitCost`.

## API changes

`POST /api/approvals` with `referenceType: 'ProductionCompletion'` now records the cost, and returns
409 when a reference price is missing. No new endpoint. See `docs/api.md`.

## UI changes

Costing card on production orders; cost line and missing-price warning in the approval preview;
prices on the Stock moved card; Unit cost column in the inbox; Unit cost and Value columns and
"worth ₱…" on Finished Goods.

## Configuration / environment

None.

## How to verify

```bash
npx tsc --noEmit && npm run lint
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

Run on 2026-11-09 with curl, SQL and inline checks, on throwaway Dinuguan orders PRD-000005 to
PRD-000007. Afterwards I deleted them and every row they created: 23 notifications, 5 approvals,
14 log rows, 22 stock movements, 2 lots with their levels and movements, and 10 stock levels. Pork
Belly was restored to 4 kg with its original `updatedAt`, `prd_number_seq` is back to 4, and a test
`ItemPrice` was deleted (25 rows again). All counts match the task-start snapshot.

- Estimates for the four drafts match an independent SQL calculation (BOM qty × the newest reference
  price on or before the date): ₱1242.33, ₱5716.50, ₱3726.98, ₱1905.50.
- Pending 9.6 kg run: planned ₱1905.50 · ₱190.55/kg; batch ₱1905.50 · ₱198.49/kg; variance +₱76.22,
  matching the hand calculation.
- Missing price (planned date briefly moved before any price, then restored exactly): the card
  marks every line "No price"; approving → 409 naming each material and date; status and stock
  unchanged.
- Approval stored ₱1905.50 / ₱1905.50 / ₱198.489583 / +₱76.22. The 11 `OUT` rows carry their prices
  and their values sum exactly to the batch cost. The lot carries ₱198.489583/kg. The notification
  shows the cost.
- A back-dated Pork Belly price (₱500 from 2026-11-01, added through the admin API) left the
  recorded cost untouched and moved a draft's estimate by 4 kg × ₱120.
- Inbox unit cost ₱200.58/kg for a 9.5 kg report. Finished Goods: 19.4 kg · 2 lots · worth ₱3811.00,
  each lot's unit cost and value.
- `formatPeso`: 13 cases including half-centavos, negatives, zero, carry (99.995 → 100.00) and the
  exponent fallback.

## Risks / assumptions / follow-up

- Cost is ingredients only, at reference prices. No labour, gas or packaging, and no actual purchase
  cost. Moving to a purchase-cost method later would need receipt-based valuation.
- A run approved before this change would have no recorded cost; none exist.
- The recorded breakdown shows each ingredient's price but not the date it took effect (the ledger
  keeps the price only).
- The inbox runs a price query per pending completion as well as the stock query; fine at today's
  volume.
- Expiry (shelf life per finished good) is the last open Week 6 task.
