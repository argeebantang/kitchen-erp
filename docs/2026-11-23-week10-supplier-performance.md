# 2026-11-23 — Supplier Performance Analyzer and supplier lead times (Week 10, Task 3)

Week 10 roadmap task "FEATURE 6 — Supplier Performance Analyzer: Claude reviews all RR variance data per supplier and
generates a supplier reliability report monthly. Flags suppliers with consistent short deliveries." It also settles
gap 1 of the Week 10 plan, supplier lead time, which the Reorder Recommender (Task 4) plans with.

It builds on Task 2's pieces (`AiInsightPanel`, `POST /api/ai/insights`, `AI_SCHEDULED_JOBS`, structured output;
`docs/2026-11-23-week10-waste-pattern-detector.md`) and on the history data of Task 1, whose supplier patterns are its
answer key.

What it gives:
- **Dashboard → KitchenAI insights → Suppliers — <month>.** Seen by ADMIN, ACCOUNTING, PROCUREMENT_MANAGER and
  VIEWER. It covers a month that has ended, the last by default, with a month picker and a supplier filter.
  - **The figures, worked out by the system:** received, short-delivered (what did not come, at the line's cost),
    rejected, and still unfilled.
  - **Per supplier:** short deliveries, rejected lines, orders late against the promised date and by how many days,
    the lead time it delivered in against the one it promises, and unfilled orders.
  - **The flags the rule sets.**
  - **Materials that came short.**
  - **Claude's review** (AI badge): a summary and up to 5 findings, each with what procurement should do and the rows
    it rests on.
- **On the 1st of every month at 06:00** the review of the month that ended is written by itself. **Review <month>**
  and **Regenerate** are on the card too.
- **Master Data → Suppliers** (new tab): each supplier's lead time.
  - **Promised:** editable by an admin.
  - **Measured:** the median days from an approved order to its first delivery over the last 180 days, and on how
    many orders.
  - **Which one reorders plan with.**

Built in subtasks 3.1–3.3. Steps are in `docs/week10-task3-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| L1 | **Lead time: both, with a fallback** (gap 1). The order of preference: **measured** (the median Manila days from a PO's approval to its first approved receiving report, over POs approved in the last 180 days, once there are at least 3); then **promised** (`Supplier.leadTimeDays`, set in Master Data); then **2 days**. `SupplierService.leadTimes()` returns the figure with its source | What a supplier really does beats what it says. A new supplier still gets its promise, and a figure with its source can be explained |
| L2 | **A minimal Suppliers tab**: the list, the promised lead time (whole days 1–60, or empty) and the measured one. ADMIN, like the rest of Master Data. `PATCH /api/suppliers/[id]` | The app had no supplier screen at all. Adding and editing suppliers stays a follow-up |
| S1 | **One report per calendar month:** insight (`SUPPLIER_PERFORMANCE`, `'Month'`, `'2026-10'`), covering receiving reports approved in that month (Manila). Only a month that has ended can be reported on | A month is the roadmap's period. A month still running would be judged on part of it |
| S2 | **The flag rule (owner's call, see below):** flagged **short** when at least **3** of the month's deliveries came short **and** they are at least **25 %** of them. Flagged **late** when at least 3 orders arrived after the promised date and they are at least 25 % of the orders first delivered that month. The rule is applied by code (`FLAG_MIN_COUNT`, `FLAG_MIN_PCT`); Claude repeats it, never invents flags | The plan's "3+ deliveries **or** 25 %+ of lines" flagged all three suppliers on the history's volumes: about 30 deliveries a month gives even a reliable supplier 3 short ones, and 25 % of lines flagged nobody. The share of deliveries separates them (Oct: Nueva Ecija 39 %, Divisoria 14 %, Bantang 10 %). Lateness uses the same rule because Divisoria's pattern is lateness |
| S3 | **The figures** (`SupplierReportRepository`, Postgres sums in Decimal): per supplier, deliveries, lines, short lines and short deliveries, short value ((expected − received) × the line's cost), rejected lines and value, received value. Orders first delivered in the month: late or not against `expectedDelivery`, average and most days late, median lead time, and those still unfilled (ordered − accepted > 0, at cost). Per supplier × material, the lines that came short | Code computes, Claude explains (P1) |
| S4 | **Shared findings format** (`services/ai-findings.ts`): schema, parser, "keep findings that name real rows", "findings about these rows". Feature 3 moved onto it | Two reports of the same shape; one place for the check |
| S5 | **Who:** sees it — ADMIN, ACCOUNTING, PROCUREMENT_MANAGER, VIEWER. Generates — ADMIN, ACCOUNTING, PROCUREMENT_MANAGER. The `/api/ai/insights` guard now admits PROCUREMENT_MANAGER; the registry keeps procurement off the waste report | Owner, 2026-11-21 |
| S6 | **A supplier filter** on the card (by name), like the Waste card's branch filter: the table and materials narrow to it, and the findings to those citing its rows | The owner asked for filters on the waste report |
| S7 | Sonnet 5.5, effort `low`, max tokens 8,000. A month with no deliveries is written without calling Claude | Measured about $0.018 a report |

## What changed

- *3.1 Lead times.*
  - Migration `20261123120000_supplier_performance`: `Supplier.leadTimeDays` (nullable int), and
    `AiFeature` / `AiInsightType` gain `SUPPLIER_PERFORMANCE`.
  - `repositories/supplier.repository.ts`: `findAll`, `setLeadTime`, `measuredLeadTimes`.
  - `services/supplier.service.ts` (new).
  - `app/api/suppliers/[id]/route.ts` (new); middleware guard `/api/suppliers` (ADMIN).
  - `components/master/SuppliersPanel.tsx` (new) and the Suppliers tab.
  - History generator: the suppliers it creates get their promised lead time (Nueva Ecija 2, Divisoria 3). The two
    existing history rows were set to the same.
- *3.2 The report.*
  - `repositories/supplier-report.repository.ts`, `services/supplier-performance.service.ts`,
    `services/ai-findings.ts` and `components/ai/SupplierReportCard.tsx` (all new).
  - Feature 3 moved onto the shared findings module.
  - `lib/queue.ts`: `SUPPLIER_PERFORMANCE_REPORT`, `SUPPLIER_PERFORMANCE_MONTHLY` (`'0 6 1 * *'`), `SupplierPerformanceJob`.
  - `worker/index.ts`: both jobs, and give-up.
  - `services/ai-insight.service.ts`: the registry entry.
  - `lib/claude.ts`: the feature's settings.
  - The dashboard reads `?supplierMonth=` and `?supplier=`.
- *3.3 Docs.* This note; `progress.md`; the roadmap; `api.md`, `database.md`, `architecture.md`, `overview.md`.

## Database

Migration `20261123120000_supplier_performance`, additive: `Supplier.leadTimeDays INTEGER NULL`, and the enum values
above. Reports are `AiInsight` rows (`'Month'`, `'2026-10'`). Still 35 models.

## API

- **New** `PATCH /api/suppliers/[id]`, body `{ leadTimeDays: 1–60 | null }`.
  - 200 `{ supplier: { id, leadTimeDays } }`; 400 validation; 404 unknown supplier.
  - ADMIN only.
- `POST /api/ai/insights` accepts `type: 'SUPPLIER_PERFORMANCE'`, `referenceId: '2026-10'`.
  - 400 unknown month, or a month not ended.
  - 403 for roles other than ADMIN, ACCOUNTING, PROCUREMENT_MANAGER.
  - The guard admits PROCUREMENT_MANAGER now.

## UI

- Dashboard: **Suppliers — <month>** (above).
- Master Data: **Suppliers** tab.
- AI Settings lists "Supplier performance". The monthly job's call shows as "Background job".

## Configuration

None. After pulling: `npx prisma migrate dev`, then restart `npm run dev` and `npm run worker`.

## How to test

1. As Juan (procurement): the Dashboard shows only the Suppliers card, for October 2026.
   - Nueva Ecija Fresh Produce is flagged **short** ("short on 13 of 33 deliveries (39.4%)").
   - Divisoria Dry Goods Trading is flagged **late** ("late on 15 of 26 orders (57.7%)").
   - The review's findings each show their rows.
2. Supplier filter → Nueva Ecija → Show: only its row and materials; "2 of 5 findings are about …".
3. Month → September → Show: "Review September 2026" (about 2 cents).
4. As Admin: Master Data → Suppliers.
   - Bantang: measured 1 day over 79 orders, no promise → "1 days (measured)".
   - Set a promised lead time and Save; clearing it saves empty.

What Claude checked (2026-11-23):
- **October figures:** the per-supplier deliveries, short deliveries and lines equal an independent SQL count
  (Bantang 30 / 3 / 4, Nueva Ecija 33 / 13 / 14, Divisoria 28 / 4 / 4).
- **The 43-day-late order is real:** the owner's own PO-000002 (promised Sep 16, received Oct 29).
- **October review:** $0.0176, 6.6 s. All 41 numbers it quoted are in the facts. Both flags were found and explained.
  It recommends ordering from Divisoria by its measured 4 days instead of the promised 3.
- **Refusals:**
  - a month not ended → 400
  - a malformed month → 400
  - production → 403
  - viewer → redirect
  - procurement regenerating the waste report → 403
- **Dashboard per role:**
  - admin and accounting: both cards
  - procurement: Suppliers only
  - production: Waste only
  - viewer: both, no Regenerate
  - branch manager: none
- **Lead times:** Bantang 1 day (79 orders), Divisoria 3 (77), Nueva Ecija 2 (76), all measured.
- **Checks:** `tsc`, `eslint`, no schema drift.

## The owner's call

The flag rule is a business rule, built as recommended because the agreed one flagged everyone. On the history,
September flags **Bantang** as short as well (9 of 29 deliveries, 31 %), mostly 0.5 kg / L shorts on small lines: a bad
month by chance for the "reliable" supplier. Raising `FLAG_MIN_PCT` to 35 would flag only Nueva Ecija in both months.
Left at 25 until the owner decides.

## Risks, assumptions, follow-ups

- **The review is Claude's.** The flags and every figure are the code's.
- **The report's measured lead time is the month's median; the Suppliers tab's is the last 180 days'.** They can
  differ (Divisoria: 4 in October, 3 over 180 days). Reorders use the 180-day one.
- **No supplier create or edit screen yet:** suppliers still come from the seed.
- **The supplier filter is by name.** Names are not unique in the schema.
- **Unfilled orders are counted when the report is read,** so an order filled later drops out of an old month's card
  (the stored facts keep what Claude saw).
