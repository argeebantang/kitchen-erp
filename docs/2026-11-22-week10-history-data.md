# 2026-11-22 — History data and outlet daily sales (Week 10, Task 1)

The first task of Week 10 ("KitchenAI — Predictive Features"). Four of the week's features read the past: the Waste
Pattern Detector (30 days of write-offs), the Reorder Recommender (daily usage), the Demand Forecaster (production by
weekday and holidays) and the Supplier Performance Analyzer (deliveries per supplier). The database had almost none of
it after the Week 9 clean-ups: 1 kitchen, 0 outlets, 1 supplier, 1 receiving report, 0 completed runs, 0 write-offs,
0 stock requests. Without history those features cannot be built or checked on real data. So this task pulls Week 12's
"Realistic seed data" forward (owner, 2026-11-21, "do all recommend").

Building it showed a gap in the app: **outlet sales were not recorded**. End of Day said "sold Lechon still shows on
hand". Ninety days of deliveries would have left every outlet with thousands of kg of expired goods on its books, and
F3 / F5 could not tell what sold. The owner chose to add outlet daily sales (2026-11-22), so this task also adds that
feature.

What it gives:
- **`npm run seed:history`**: 90 days, ending yesterday, of realistic, back-dated activity written to the database in
  about 45 seconds. It covers the app's flows from purchase request to write-off, with built-in patterns for the AI
  features to find (listed below). `--clean` removes exactly what it added.
- **Daily Sales** (`SLS-000001`): at closing, an outlet's manager records what was sold. The goods leave the outlet's
  lots, End of Day gains a **Sold** column, and sales have takings, cost of goods and margin.

Built in subtasks 1.1–1.6. Steps are in `docs/week10-task1-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| H1 | A separate generator, `prisma/history/` (`npm run seed:history`), not part of `prisma/seed.ts` | `seed.ts` is idempotent master data. History is optional and removable |
| H2 | It writes straight to the database, one transaction per document, through the repositories' own ledger writes (`InventoryRepository.stockIn/stockOut`, `FinishedGoodStockRepository.receiveLot/takeFromLot/transferIntoLot`) and the same cost formulas as the services. The rows are then back-dated by document reference | The services refuse past dates, stamp "now", and queue notifications and AI jobs (hundreds of Claude calls). Reusing the ledger writes keeps the ledger rules identical |
| H3 | Window: 90 days ending yesterday (Manila). Purchasing starts 7 days earlier, so the kitchens have stock on day 1. `--days`, `--seed` (default 20261122): the same seed gives the same history | F3 needs 30 days, F5 8 weekdays back, F6 whole months |
| H4 | Places: Main Commissary plus **Pasig** and **Las Piñas Commissary**; **Cubao**, **Makati** and **Alabang Outlet**. People: new history staff — Rosa Dela Cruz (production), Carmen Reyes (accounting), Nestor Garcia (procurement), and a manager per outlet (Lorna Bautista, Jun Mercado, Grace Villanueva) — at `@history.kitchen.com`, password as in `seed.ts`. Your seed users do not appear in the history | Several kitchens, outlets never cook (owner, 2026-11-20). The actors are how `--clean` finds every history document, with no marker in any visible field |
| H5 | Suppliers: Bantang Meat Supply (existing) plus Nueva Ecija Fresh Produce and Divisoria Dry Goods Trading, each with supplier rates. Reference prices back-dated to 2026-06-01 for Whole Pig and Lemongrass (their first price was Nov 1), noted "Back-filled for the history data" | Runs before Nov 1 must be costed. A back-dated price older than every existing one changes no current price |
| H6 | `--clean` refuses (deleting nothing) if any of your own data depends on the history, e.g. your transfer to a history outlet. Otherwise it deletes children first, recomputes the stock levels the history touched at your branches from the remaining ledger, and resets each number sequence to the highest number left | Exact removal; levels stay reconciled |
| H7 | Not test data: it stays through Week 10 (and for Week 12's demo) until `--clean` is run. No notifications are sent and no AI is called | Every feature this week builds on it |
| S-1 | **Outlet daily sales** (owner, 2026-11-22): `OutletSale` / `OutletSaleItem`, `SLS-000001` (`sls_number_seq`), one per outlet per business day | Sold goods stayed on the books; F3 and F5 need what actually sold |
| S-2 | Recorded by the outlet's manager (`Branch.managerId`) or an ADMIN, for **today or yesterday** (closing after midnight). No approval, like a return | The outlet is the only one who knows what it sold; the takings are checked against the till, not approved |
| S-3 | Stock: each good is taken from the outlet's lots **soonest expiry first, never an expired lot** (`planFefoTakes`, under the lot lock), as `OUT` movements with `referenceType 'OutletSale'`. More than the outlet has unexpired and unclaimed → 409, naming each good | The delivery and return rule. Expired food is a write-off, not a sale |
| S-4 | Each line keeps `unitPrice` (the good's selling price then) and `amount`. The sale keeps `totalAmount` (takings) and `totalCost` (the lots' recorded cost), never recomputed | A later price change must not rewrite a day's takings; margin is takings − cost |
| S-5 | Pages: **Daily Sales** list (a branch manager sees only their outlet), **Record sales** form (one row per good, with what is on the books), detail (lots taken, takings, cost, margin). Branch Inventory → outlet: **Record today's sales**. End of Day: a **Sold** column and flow. The assistant's read-only login may read both tables | Same shape as Returns and Stock Requests |
| Owner | The outlets' raw-material "Out of stock" alerts on the stock map and Branch Inventory (outlets never hold raw materials) are fixed in Task 4, with F4 | Found while checking the history (2026-11-23) |

## Built-in patterns

The truths the Week 10 features should find. Re-check them after any change to the generator.

| For | Pattern | In the data (seed 20261122) |
|---|---|---|
| F5 | Weekends sell more Lechon (Sun ×1.5, Sat ×1.4, Fri ×1.15) | per outlet: Sun 25.5 kg, Sat 20.0, Fri 17.9, against 14.0–15.9 on Mon–Thu |
| F5 | Holidays: Lechon ×1.8, the viands ×1.3 (2026 list in `prisma/history/calendar.ts`, the same days Task 5's Holiday table starts with) | All Saints' Day 130 kg across the outlets and All Souls' 80, against 46–48 the week before |
| F3 | Alabang Outlet over-orders Dinuguan by half again | sells 78 % of what it asks for, against 90–94 % elsewhere; 27 Dinuguan write-offs (78 kg), the most of any outlet good |
| F3 | Kitchens cook Lechon in 20 kg batches against 14–18 kg a day | expired Lechon at the kitchens: Pasig 109 kg, Main 71, Las Piñas 59 (Pasig serves the smallest outlet) |
| F3 | Las Piñas Bopis fails the taste check now and then (20 % of its batches) | 18 FAILED_QUALITY write-offs (34.5 kg), all Las Piñas Bopis |
| F3 | Makati Outlet spoils and drops more | 5 of the 8 SPOILED / DAMAGED write-offs |
| F3 / F6 | Pasig → Makati deliveries lose goods in transit | 17 of 76 deliveries, against 4 of 80 (Main → Cubao) and 0 of 76 (Las Piñas → Alabang) |
| F6 | Nueva Ecija Fresh Produce short-delivers Red Onion | short on 29 of 79 Red Onion lines; half the shorts never arrive |
| F6 | Divisoria Dry Goods Trading is late (1–3 days) | 42 % of its 77 orders |
| F6 | Bantang Meat Supply is reliable | 4 % late |
| F4 | Las Piñas misses its last three produce orders | ends with Garlic and Red Onion 🟡 Low and Lemongrass at 0 (no reorder point, ⚪); its last requests are cut "Short on Lemongrass" |
| — | Las Piñas Bopis yields less (88–94 %) | 90.8 % against 98.5–98.9 % elsewhere |

Totals for that seed (run 2026-11-23, window Aug 25 → Nov 22): 232 purchase orders and 264 receiving reports, 273 stock
requests, 556 production orders (551 run), 260 deliveries, 268 days of sales, 68 returns, 55 conversions, 282
write-offs. Write-offs are 5.8 % of production cost. The evening of the last day plans today, so today's runs are approved and waiting to start, today's
requests are planned, and last night's return (RTN) is in transit.

## What changed

- *1.1 Roadmap, people, places, suppliers.*
  - Roadmap: Week 9 done, Week 10 next.
  - `prisma/history/`: `index.ts` (the command), `cast.ts` (who and where), `master.ts` (creates them, with prices),
    `clean.ts`, `random.ts` (mulberry32, seeded).
  - `package.json`: `seed:history`.
- *1.2 Purchasing* (`procurement.ts`, `demand.ts`, `calendar.ts`, `prices.ts`, `world.ts`, `simulate.ts`).
  - Each kitchen orders on Monday and Thursday from each supplier. The amount is expected usage until the next order,
    plus lead time and safety days, plus the reorder point (kept as safety stock), less stock on hand and on order.
  - The full flow, back-dated: PR (Rosa) → approved (Carmen) → PO (Nestor) → approved → sent → RR counted (Nestor)
    → approved, stock in.
- *1.3 Outlet daily sales* (the feature, below).
- *1.4 Production, outlet orders, deliveries, sales* (`outlet.ts`, `kitchen.ts`).
  - Afternoon: outlets ask a kitchen for tomorrow, 90 % their home kitchen. Late after 15:00: Makati 25 %, others 5–8 %.
  - Evening: the kitchen plans. A cut always gives a reason ("Short on Whole Pig — sending what we can"), about 1 % are
    declined, and runs are scheduled only from ingredients on hand, so no stock goes negative.
  - Morning: runs started, reported with the real yield, signed off. Ingredients go out at the day's reference prices
    and a costed lot comes in.
  - Late morning: deliveries recorded, dispatched and received, fulfilling the request.
  - Closing: the outlets record their sales.
- *1.5 Waste* (`waste.ts`).
  - Closing: outlets return Lechon that will not last another day.
  - Morning: kitchens convert Lechon about to expire into Paksiw, up to 3 days of Paksiw sales, and the evening plan
    cooks that much less Paksiw. Every lot expired overnight is written off; occasional spoiled, damaged and
    failed-quality write-offs.
  - Las Piñas misses its last three produce orders, for real 🟡 tiles at the end (Feature 4).

## The outlet daily sales feature

**Database**: migration `20261122120000_outlet_sales`, additive only:
- Table `OutletSale`: `saleNumber`, `branchId`, `soldOn` (date, midnight UTC), `submittedById`, `notes?`,
  `totalAmount`, `totalCost`, `createdAt`.
  - unique `(branchId, soldOn)`
  - index `soldOn`
- Table `OutletSaleItem`: `outletSaleId` (`ON DELETE CASCADE`), `finishedGoodId`, `quantity`, `unitPrice`, `amount`.
  Unique `(outletSaleId, finishedGoodId)`.
- Sequence `sls_number_seq`.
- `GRANT SELECT` on both tables to `kitchen_ai_reader`.
- 35 models.

**API**: `POST /api/outlet-sales` (ADMIN, BRANCH_MANAGER). See `docs/api.md`.

**Code**:
- `repositories/outlet-sale.repository.ts`, `services/outlet-sale.service.ts`, `app/api/outlet-sales/route.ts` (new).
- `services/stock-transfer.service.ts`: `availabilityAt` exported and reused, so a sale checks stock exactly like a
  transfer or return.
- End of Day: `DayFlow` gains `sold` (`OUT` + `OutletSale`) in `finished-good-stock.repository.ts`, the service, the
  page (column, total, document label, wording) and the evening summary (`notification.service.ts`).
- `SOURCE_PAGES.OutletSale` (links from End of Day).
- `services/assistant-tools.ts`: the assistant's schema text lists the two tables.

**UI**:
- `/inventory/sales` (list), `/inventory/sales/new` (`OutletSaleForm`), `/inventory/sales/[id]` (detail). Sidebar
  **Daily Sales**: ADMIN, ACCOUNTING, PRODUCTION_MANAGER, BRANCH_MANAGER.
- Branch Inventory → an outlet: **Record today's sales**.
- End of Day: **Sold**.

`middleware.ts` guards `/inventory/sales` (those four roles), `/inventory/sales/new` and `/api/outlet-sales` (ADMIN,
BRANCH_MANAGER).

## Configuration

None. After pulling: `npx prisma migrate dev` (or `migrate deploy`), then restart `npm run dev`, which otherwise keeps
the old Prisma client and answers 500.

## How to test

1. `npx prisma migrate dev`, restart `npm run dev`, then `npm run seed:history`. It prints the counts in about 45 s.
   Run it again: "History data already exists".
2. **Daily Sales:** as `lorna.bautista@history.kitchen.com`, go to Branch Inventory → Cubao Outlet → Record today's
   sales.
   - Too much → amber warning, button off.
   - A valid entry → the detail page with lots, takings, cost and margin.
   - The same day again → "already recorded".
3. **End of Day** (any day in the window, e.g. 2026-11-01): Sold, Written off, Converted in / out and Distributed
   filled, every row ✓.
4. **The patterns:** Write-offs filtered to Expired (Alabang Dinuguan) and Failed quality (Las Piñas Bopis); a Pasig →
   Makati transfer with a loss; Stock Levels → Las Piñas Garlic and Red Onion 🟡; the Costing dashboard's 12 weeks.
5. **Clean:** `npm run seed:history -- --clean` lists what it removed, and your own data is back as it was. Then
   `npm run seed:history` again.

What Claude checked (2026-11-22/23):
- **Ledgers:** after generation, every material level (63) and finished-goods level (1,362) equals its ledger, and
  none is negative.
- **Costs:**
  - every sale's totals equal its lines and its cost equals the lots taken
  - every lot carries its run's cost per kg
  - write-off cost = quantity × lot cost
  - conversion cost per kg = (source + ingredients) ÷ output
- **End of Day:** every finished-goods movement (5,406) falls into a named flow, so no "Unrecognised" rows.
- **`--clean`:** against a snapshot taken before any history (counts, checksums, sequences), identical. The only
  difference is the new `sls_number_seq`. It refused when your user Pedro was assigned to a history outlet.
- **Sales API:**
  - the wrong role → middleware redirect
  - a manager of no outlet → 404
  - a kitchen → 400
  - two days ago or tomorrow → 400
  - a good twice → 400
  - zero → 400
  - no lines → 400
  - more than on the books → 409
  - the same day twice → 409

  Takings and cost were checked by hand.
- **Checks:** `tsc`, `eslint`, no schema drift. Screenshots of every page were reviewed.

## Risks, assumptions, follow-ups

- **History is not real.** The patterns are designed, so an AI feature that "finds" them proves it reads the data, not
  that the business has those problems. The patterns table above is the answer key.
- **One sale per outlet per day, no edit.** A mistake can't be corrected yet. Add a correction (or an admin delete that
  puts the stock back) if needed.
- **Sales do not check the till.** Takings are the selling price × quantity. There is no payment record.
- **The window moves with the run date.** Re-running on another day shifts every date. Re-run after `--clean` when
  fresh "last 30 days" figures are needed.
- **`--clean` and your testing.** Your own documents at history branches (e.g. a transfer to Cubao Outlet) block
  `--clean` until removed. Your production at Main Commissary using history-bought ingredients does not block it, but
  after `--clean` those levels can go negative.
- **Purchasing in the history ignores conversions' extra ingredient use.** A conversion is skipped when an ingredient
  is short, and that Lechon is written off.
- **Follow-up (Task 4):** outlets show raw-material "Out of stock" alerts on the stock map and Branch Inventory.
