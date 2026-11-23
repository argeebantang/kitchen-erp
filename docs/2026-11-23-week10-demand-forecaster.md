# 2026-11-23 — Demand Forecaster, Production → Plan and the Holiday calendar (Week 10, Task 5)

Week 10 roadmap task "FEATURE 5 — Demand Forecaster: kitchen supervisor opens production planning screen. Claude looks
at historical production by day of week and upcoming calendar (holidays) and suggests how many batches to produce
today." It also settles gap 2 of the Week 10 plan (an admin-managed Holiday table, pre-filled) and gap 4 (the forecast
per kitchen per finished good).

It builds on the history data of Task 1 (weekday pattern, All Saints' / All Souls' Day, Las Piñas Bopis yield), Task 2's
insight pieces, and Week 9's stock requests and their "Plan production" pre-fill.

What it gives:
- **Production → Plan** (new; ADMIN, PRODUCTION_MANAGER, ACCOUNTING): one kitchen and one day, **tomorrow by default**,
  any day from today to 14 days ahead.
  - **Per good, worked out by the system:**
    - requested by the outlets
    - the usual amount on that weekday (average, range, days)
    - the demand used and where it comes from
    - − finished stock still good that day
    - ÷ the kitchen's yield
    - − runs already planned (linked)
    - = cook more, giving **batches**
  - **Plan production →** opens the production order form pre-filled (kitchen, day, good, batches).
  - **By day of the week:** the average asked per weekday over 8 weeks, with the planned day highlighted.
  - **Past holidays at this kitchen:** each good asked against its usual weekday (×1.8 for Lechon on All Saints' and
    All Souls' Day).
  - The day's **holiday badge**, and whether the outlets' requests are in yet.
  - **About this plan** (AI badge): **Explain this plan** / Regenerate, about a cent. It says when the figures have
    changed since it was written.
- **Master Data → Holidays** (new tab, ADMIN):
  - A year picker; add, edit and remove days.
  - Types: regular, special non-working, special working, local (fiesta, event).
  - Pre-filled with the 2026 Philippine regular and special non-working days.

Built in subtasks 5.1–5.4. Steps are in `docs/week10-task5-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| F1 | **The code works out every figure** (P1). **Demand:** once the cut-off on the day before has passed (`STOCK_REQUEST_CUTOFF`, 15:00), the day's requests. Answered requests count at their planned quantity, unanswered ones at what was asked, declined ones at 0. Before the cut-off, the larger of the requests so far and the **usual amount**: the average asked on the same weekday over the **8 weeks** before, leaving out holidays and days with no requests. **To cover** = demand − finished stock at the kitchen still good at the end of the day. **To cook** = to cover ÷ yield (the kitchen's completed runs of that good over the last 30 days, actual ÷ planned, capped at 100 %). **Cook more** = to cook − runs already planned for the day (any stage but rejected and cancelled). **Batches** = cook more ÷ the active recipe's batch size, rounded up | Gap 4 of the plan, with the margin read as "the usual amount while requests are open": in the history, late requests arrive before the kitchen plans, so a "late extra" margin was near zero. The usual weekday amount is what the history actually teaches |
| F2 | **Holidays are shown, not scaled.** The day's holiday is badged. Past holidays (last 120 days, with requests) are listed per good as asked against their usual weekday. Holidays are left out of the weekday averages. Claude may advise more or fewer batches, as advice, never as a figure | A holiday's effect differs by holiday (All Saints' ×1.8 for Lechon; most days nothing), and the history has only a few. A single factor would be false precision. Claude's comment is where judgement belongs |
| F3 | **Stock carried over** counts lots at the kitchen not expired by the end of the day. Deliveries due before that day are assumed to be covered by their own day's runs | The planner's moment is the evening before, when today's deliveries have gone (as in the history) |
| F4 | **Full recipe batches**, as the Demand board does. "Cook more" shows the kg, so a 0.8 kg need against a 10 kg batch is visible; the production order form lets the batch weight be changed | Consistency with Week 9's board; a pig is a whole batch |
| F5 | **Explain on request** (like Feature 4), queued on the `ai` queue. One insight per kitchen and day (`DEMAND_FORECAST`, `'KitchenDay'`, `'<kitchenId>:<YYYY-MM-DD>'`). Figures are always live; the stored check (per good: demand, stock, planned, batches; requests closed; holiday) flags an outdated text | Plan P4/P5, as amended in Task 4 |
| F6 | **Who:** the page is for ADMIN, PRODUCTION_MANAGER, ACCOUNTING (the `/production` guard). **Explain / Regenerate** and **Plan production** are for ADMIN and PRODUCTION_MANAGER: the kitchen's planners, matching `/production/orders/new` | Accounting reads |
| F7 | **The page defaults to tomorrow** and allows today to +14 days. Past days are not planned | Owner, 2026-11-21 |
| H1 | **Holiday table** (gap 2): one row per date (`date` unique, midnight UTC like `plannedDate`), name, type (`REGULAR`, `SPECIAL_NON_WORKING`, `SPECIAL_WORKING`, `LOCAL`). Admin-managed in Master Data. **Pre-filled in the migration with the 2026 regular and special non-working days**, including All Souls' Day (Nov 2), which the history's demand also rises on. **Eid'l Fitr and Eid'l Adha are not pre-filled** (proclaimed separately), nor is 2027 | National days change yearly by proclamation; fiestas and events are the business's own. A list in code goes stale |
| H2 | Sonnet 5.5, effort `low`, max tokens 3,000; at most 6 sentences under 130 words; the day by its date, never "today" unless it is. Measured at about $0.009–0.010 | Feature 1's pattern. The first draft said "Today is Bonifacio Day" for Nov 30 and ran long; fixed in the instructions |

## What changed

- *5.1 Holidays.*
  - Migration `20261123180000_holidays_demand_forecast`: `HolidayType` enum, `Holiday` table, 18 days of 2026,
    `GRANT SELECT` to `kitchen_ai_reader`, and `AiFeature` / `AiInsightType` gain `DEMAND_FORECAST`.
  - `repositories/holiday.repository.ts`, `services/holiday.service.ts` (new).
  - `app/api/holidays/route.ts` (POST), `app/api/holidays/[id]/route.ts` (PATCH, DELETE), `app/api/holidays/schema.ts`;
    middleware guard `/api/holidays` (ADMIN).
  - `components/master/HolidaysPanel.tsx` (new), the Holidays tab in `MasterTabs` and the master page.
- *5.2 The forecast and the page.*
  - `repositories/demand-forecast.repository.ts` (new): `requestedByDay`, `plannedRuns`, `yields`.
  - `services/demand-forecast.service.ts` (new): `options`, `forecast`.
  - `app/(protected)/production/plan/page.tsx` and `components/production/DemandPlan.tsx` (new).
  - `lib/navigation.ts`: Production → Plan.
- *5.3 The explanation.*
  - `services/demand-forecast.service.ts`: `request`, `explain`, `giveUp`.
  - `lib/queue.ts`: `DEMAND_FORECAST_EXPLAIN`, `DemandForecastJob`.
  - `worker/index.ts`: handler and give-up.
  - `services/ai-insight.service.ts`: registry entry.
  - `lib/claude.ts`: the feature's settings.
- *5.4 Docs.* This note; `progress.md`; the roadmap; `api.md`, `database.md`, `architecture.md`, `overview.md`.

## Database

Migration `20261123180000_holidays_demand_forecast`, additive:
- New table `Holiday` (`id`, `date` unique, `name`, `type`, timestamps) and enum `HolidayType`.
- 18 rows for 2026 (hand-written `INSERT … ON CONFLICT DO NOTHING`; cuid-shaped ids).
- `GRANT SELECT ON "Holiday" TO kitchen_ai_reader`.
- `AiFeature` and `AiInsightType` gain `DEMAND_FORECAST`.
- 36 models.

Development note: All Souls' Day was added to this migration after it had been applied here. The row was inserted and
the migration's checksum updated in `_prisma_migrations`, so this database matches a fresh apply. `migrate status`
reports it up to date.

## API

- **New** `POST /api/holidays` `{ date: YYYY-MM-DD, name (1–100), type }`.
  - 201 `{ holiday }`; 400 validation; 409 the date already has one.
- **New** `PATCH /api/holidays/[id]` (same body).
  - 200; 400; 404; 409 date taken.
- **New** `DELETE /api/holidays/[id]`.
  - 200 `{ id }`; 404.
- All three are ADMIN only.
- `POST /api/ai/insights` accepts `type: 'DEMAND_FORECAST'`, `referenceId: '<kitchenId>:<YYYY-MM-DD>'`.
  - 400 malformed.
  - 403 roles other than ADMIN, PRODUCTION_MANAGER.
  - 409 not an active kitchen, a day outside today … +14, or nothing to plan.

## UI

As listed at the top. The sidebar gains Production → **Plan**. AI Settings lists "Demand forecaster".

## Configuration

None. After pulling: `npx prisma migrate dev`, then restart `npm run dev` and `npm run worker`.

## How to test

1. As **Maria** (production): **Production → Plan**. It opens on tomorrow (Tue, Nov 24) at Main Commissary.
   - The requests are still open (before 15:00 today), so demand is the usual Tuesday amount.
   - Switch to **Las Piñas Commissary**:
     - Bopis yields **90.7 %**, so 3.36 kg demand → 3.704 kg to cook, 1 batch.
     - Lechon is **Covered** by your catering run **PRD-000561** (240 kg, Task 4 test data).
2. **By day of the week:** Lechon rises from about 17 kg on Mondays to 28 on Sundays (Las Piñas).
   - Past holidays: All Saints' Day ×1.82 and All Souls' Day ×1.80 for Lechon.
3. Day → **Mon, Nov 30**: the 🎌 **Bonifacio Day** badge.
   - "About this plan" is already written; it advises considering one more batch of Lechon.
   - Press **Regenerate** if you like (about a cent).
4. Day → **today (Nov 23)**: "requests are in", the plan follows them, and today's runs are listed under Planned.
5. **Plan production →** on any row: the production order form opens with the kitchen, day, good and batches.
6. As **Liza** (accounting): the page shows, but no Explain or Plan production buttons. As **Juan**, **Ana** or **Pedro**:
   no access.
7. As **Admin**: **Master Data → Holidays**.
   - 2026 lists 18 days.
   - Add *Eid'l Fitr* when you have its date (type special non-working, or regular if proclaimed so).
   - Add a Local day, edit it, remove it.
   - 2027 is empty.

What Claude checked (2026-11-23):
- **Usual amounts against SQL:**
  - Las Piñas Lechon on Tuesdays 19.43 over 7 days, as an independent SQL average.
  - On Mondays 17.08 over 6 days once Nov 2 is a holiday. It was 19.07 with Nov 2 counted, so the holiday
    exclusion works.
- **The forecast by hand:**
  - Bopis 3.36 ÷ 0.907 = 3.704 → 1 × 8 kg.
  - Today's Bopis: 3 requested − 2.82 still good = 0.18 → covered by the 8 kg already planned.
- **Explanations:** $0.0097, then $0.0087 after the instructions were tightened. Every number quoted is in the figures.
  The second calls Nov 30 by its date.
- **Refusals:**
  - accounting → 403
  - a day 2027 / an outlet → 409
  - a malformed position → 400
  - a second request while writing → `queued: false`
- **Holidays API:**
  - add 201
  - same date 409
  - bad type / empty name 400
  - production → redirect
  - edit onto a taken date 409
  - edit 200, delete 200, delete again 404
  - The test day was removed.
- **Page per role:** production gets 4 Plan production links and Explain; accounting neither; procurement, viewer and
  branch manager are redirected. A Plan production link opens the pre-filled form.
- **Checks:** `tsc`, `eslint`, no schema drift.

## Risks, assumptions, follow-ups

- **The holiday list must be kept.** Check 2026 against the proclamation, and add Eid'l Fitr / Eid'l Adha and 2027
  when they are announced.
- **Holiday effects are not in the numbers.** With a year of history, a per-holiday factor (same holiday last year)
  could be computed; the history has 90 days.
- **Stock carry-over assumes earlier days are covered by their own runs** (F3). Planning two days ahead while
  tomorrow's runs are not yet made can count the same stock twice.
- **Full batches only** (F4). For small Monday demand (Dinuguan 0.75 kg at Las Piñas) the plan says 1 × 10 kg; the
  "Cook more" column shows the real need.
- **Lechon Paksiw also comes from conversions.** Its stock counts converted lots, but the plan does not forecast
  conversions.
- **The page shows one kitchen.** A view of all kitchens at once, and the dashboard card, are for Task 7.
