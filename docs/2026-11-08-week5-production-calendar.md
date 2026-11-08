# 2026-11-08 — Production schedule calendar (Week 5, Task 7) — Week 5 complete

Week 5 Task 7, "Production schedule calendar view", the last task of Week 5. Production orders now
appear on a month calendar by production date at `/production/schedule`, with each day's planned
load, filters, and a "+" to plan a run on a given day.

Built in subtasks 7.1–7.2. Tracker: `docs/week5-task7-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Month grid at `/production/schedule?month=YYYY-MM`, previous / next / Today; chips (number · finished good · planned qty) coloured by status, linking to the order | The planning horizon on one screen; a week view adds little at today's volumes. |
| D2 | Week starts on Sunday | The usual Philippine calendar convention. |
| D3 | Shows DRAFT, PENDING_APPROVAL, APPROVED, IN_PROGRESS, COMPLETED; REJECTED / CANCELLED only with "Show rejected & cancelled", struck through and never counted in day totals | A calendar is for what will be, or was, cooked. |
| D4 | Branch filter (default all) and the tickbox, in the URL; month links keep them | Same pattern as the orders list. |
| D5 | Day total = planned output per unit, summed in Decimal on the server | How heavy each day is; units are never added together. |
| D6 | ADMIN, PRODUCTION_MANAGER, ACCOUNTING (read); sidebar "Production Schedule"; List ↔ Calendar links; "+" for planners on today and later days → `/production/orders/new?date=` | A planning tool, not just a view. No guard change: `/production` already admits these roles. |
| D7 | One query over the visible weeks (≈6), capped at 500 (one extra row fetched to detect truncation), with a new `ProductionOrder(plannedDate)` index | Bounded by the calendar; no pagination. |
| D8 | On a phone the grid scrolls sideways inside its box; the page does not | Office tool first; one layout. |
| — | Month arithmetic in `lib/dates.ts`, no date library | CLAUDE.md: no new dependency without clear need; it is ~40 lines. |

## What changed

- *7.1 Calendar page.* Migration `20261108141128_production_order_planned_date_index`.
  `monthGrid()`, `addMonths()`, `monthLabel()`, `MONTH_PATTERN` in `lib/dates.ts` — UTC maths on
  date labels (dates are stored at UTC midnight), with "today" still from `todayIsoDate()` in
  Manila. `ProductionOrderRepository.findPlannedBetween()`; `ProductionOrderService.schedule()`
  (groups by day, Decimal totals per unit, `truncated`). `ScheduleCalendar` (Server Component,
  `CHIP_STYLES`), `/production/schedule` with month navigation and a legend; sidebar item.
- *7.2 Filters and planning.* Branch and closed-order filters (GET form, URL, kept by month links);
  day totals in each cell; "Nothing planned in …" message; "List" on the calendar and "Calendar" on
  the orders list; "+" on today and later days for planners; the new-order page reads `?date=`
  (falls back to today if past or malformed). After review the "+" was made clearly visible (it was
  nearly invisible in light grey).

## Files affected

- `prisma/schema.prisma`, `prisma/migrations/20261108141128_production_order_planned_date_index/migration.sql` (new)
- `lib/dates.ts`, `lib/navigation.ts`
- `repositories/production-order.repository.ts`, `services/production-order.service.ts`
- `app/(protected)/production/schedule/page.tsx` (new), `components/production/ScheduleCalendar.tsx` (new)
- `app/(protected)/production/orders/page.tsx`, `app/(protected)/production/orders/new/page.tsx`
- `docs/architecture.md`, `docs/database.md`, `docs/overview.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

## Database changes

Migration `20261108141128_production_order_planned_date_index` — one index; no data change, no
Prisma client change (no restart needed).

## API changes

None. The calendar is a Server Component reading through `ProductionOrderService`.

## UI changes

New Production Schedule page and sidebar item; Calendar button on the orders list; date pre-fill
on the new-order form.

## Configuration / environment

None.

## How to verify

```bash
npx tsc --noEmit && npm run lint
```

Checked during the build (throwaway orders removed afterwards, `prd_number_seq` reset):
`monthGrid` for November 2026 (5 weeks), February 2026 (4), August 2026 (6) and year rollovers;
access 200 for production and accounting, `/unauthorized` for procurement; chips on the right days,
including a Dec 1 order dimmed in November's last row; cancelled orders hidden by default and
shown struck through, not counted, with the tickbox; Nov 8 total 64 kg (30 + 24 + 10); "+" only
on today and later and only for planners; `?date=` pre-fill and its fallbacks; unknown branch and
empty month messages; invalid `?month=` falls back to the current month.

## Risks / assumptions / follow-up

- Day totals assume all of a day's runs are in comparable units; different units are listed
  side by side, never added.
- No shortage indicator on the chips — that would need a stock check per order per load; the
  order page and the approvals inbox have it.
- Only one branch exists, so the branch filter was checked with a real and an unknown id.
- Week 6 next: completing a run (stock deduction, finished goods, yield) through `transition()`.
