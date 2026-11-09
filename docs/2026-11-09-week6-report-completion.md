# 2026-11-09 — Production orders: report completion with the actual yield (Week 6, Task 1)

Week 6 Task 1, "Kitchen supervisor marks production as In Progress → Completed", together with
"Actual yield recorded vs planned yield". Start (→ In Progress) was built in Week 5 Task 6. Production
can now report an in-progress run done, with what it actually yielded. The order then waits for
accounting to sign the completion off. That sign-off moves the stock (ingredients out, finished
goods in) and is Week 6 Task 2. So in this task **nothing moves in stock**, and that is safe: a
completion-pending order still counts as committed.

Built in subtasks 1.1–1.3 and verified end to end with curl, then tested by the user in the browser.
Tracker: `docs/week6-task1-subtasks.xlsx` (not in git).

## Decisions

Week 6 shape, settled at the start of this task:

| # | Decision | Rationale |
|---|---|---|
| W6-1 | **Accounting signs a completion off before stock moves**, as with receiving reports. Production reports completion with the actual yield → `PENDING_COMPLETION`. Accounting approves (`POST /api/approvals`) → `COMPLETED`, with all stock moves in that transaction. A rejection (with a reason) sends it back to `IN_PROGRESS` | Nothing reaches the books unapproved. If stock moved when production clicked Complete, a rejected completion would need reversing movements, and there is no adjustment feature. The cost: finished goods are not on the books until accounting acts, the same as a delivery today. |
| W6-2 | Task 1 = report completion + yield vs planned (roadmap tasks 1 and 4), no stock. Task 2 = accounting sign-off with the stock movements (roadmap 2 and 8). Then costing, then batch number / expiry | Completing to `COMPLETED` without stock would be wrong: committed counts only open runs, so a completed run's ingredients would reappear as available. `PENDING_COMPLETION` keeps them committed. |
| W6-3 | *For Task 2, to confirm then:* ingredients deducted per the pinned BOM at the planned quantity; negative stock allowed and shown to the approver; finished goods in their own lot-tracked tables rather than a generalised `InventoryLevel` | Blocking would refuse a physical fact (only Pork Belly is on hand today). Lots fit expiry (Week 7) and transfers (Week 8). |

Task 1:

| # | Decision | Rationale |
|---|---|---|
| D1 | New status `PENDING_COMPLETION` ("Completion pending"), after `IN_PROGRESS`: committing, stock-checked, on the calendar, a timeline step; not cancellable | Its ingredients are still on the books until the sign-off. |
| D2 | `POST /api/production-orders/[id]/complete` `{ actualQty }`, ADMIN + PRODUCTION_MANAGER, through `transition()`; the same UPDATE sets `actualQty`, `completedAt` and the new nullable `completedById` | Task 2's "nobody approves their own completion" compares with `completedById`, as approval does with `submittedById`. A column is clearer than finding the right log row after a reject and re-report. |
| D3 | Yield > 0 and ≤ 2 × planned (`MAX_YIELD_FACTOR`), in the order's unit. Zero is a write-off (Week 7) | Typo guard like the 1–100 batch cap. Above plan is normal (a stew takes on liquid). |
| D4 | "Complete production" card on in-progress orders → dialog with the yield and the live difference from plan; amber "Completion reported — waiting for accounting" while pending | Same pattern as Start and Cancel. |
| D5 | Order details: "Actual yield 9.6 kg of 10 kg planned · −0.4 kg (96%)", computed in Decimal; the timeline step shows the yield | Roadmap task 4. |
| D6 | A reported completion cannot be edited; accounting rejects it (Task 2) and production reports again | One correction path. |
| D7 | No notifications in this task | Nobody can act on a completion before Task 2's approval; they ship with it. |
| D8 | No date rule | Same as Start. |

## What changed

- *1.1 Schema and status display.* `ProductionStatus.PENDING_COMPLETION` and
  `ProductionOrder.completedById` (relation `ProductionOrderCompleter`), migration
  `20261109054500_production_completion_pending`. The enum value is hand-placed
  `AFTER 'IN_PROGRESS'` because Prisma appends new values at the end. Added to
  `COMMITTING_STATUSES` (repository), and to `STOCK_CHECK_STATUSES` and the calendar's
  `SCHEDULED_STATUSES` (service). Violet badge (`StatusBadge`) and calendar chip, a legend entry,
  and a sixth timeline step.
- *1.2 Complete.* `ProductionOrderRepository.complete()` (via `transition()`),
  `ProductionOrderService.complete()` with `MAX_YIELD_FACTOR`, and the route (zod: decimal string).
  New `CompleteProductionOrder` (card + `Modal`; the yield is checked in integer millionths for the
  live difference; the server re-checks in Decimal). On the order page: the card for planners on
  in-progress runs, a blue note for other roles, and the amber waiting note on pending ones. The
  Start card and the requirements intro now say stock leaves when accounting approves the
  completion.
- *1.3 Yield vs planned.* The detail DTO gains `actualYield { actualQty, difference, percentOfPlan }`,
  `completedByName` and `completedAt`. `completedBy` is in the order include. Full-width "Actual
  yield" row (difference amber when short); the timeline's "Completion pending" step shows
  "Yield 9.6 kg of 10 kg planned".

## Files affected

- `prisma/schema.prisma`, `prisma/migrations/20261109054500_production_completion_pending/migration.sql` (new)
- `repositories/production-order.repository.ts`, `services/production-order.service.ts`
- `app/api/production-orders/[id]/complete/route.ts` (new)
- `components/production/CompleteProductionOrder.tsx` (new), `components/production/StatusTimeline.tsx`,
  `components/production/ScheduleCalendar.tsx`, `components/production/ProductionOrderActions.tsx`,
  `components/procurement/StatusBadge.tsx`
- `app/(protected)/production/orders/[id]/page.tsx`, `app/(protected)/production/schedule/page.tsx`
- `docs/api.md`, `docs/architecture.md`, `docs/database.md`, `docs/overview.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

## Database changes

Migration `20261109054500_production_completion_pending`: one enum value and one nullable column
with a foreign key. It only adds; there is no backfill, because every order was a draft. After
applying it, run `npx prisma generate` and restart `npm run dev` **and** `npm run worker`. Until
the restart, the running server's old client has no `PENDING_COMPLETION` and the production pages
return 500.

## API changes

`POST /api/production-orders/[id]/complete` (new). The stock check's `committed` now includes
`PENDING_COMPLETION` orders. See `docs/api.md`.

## UI changes

Complete production card and dialog; completion-pending badge, chip, legend and timeline step;
Actual yield row; waiting note.

## Configuration / environment

None.

## How to verify

```bash
npx tsc --noEmit && npm run lint
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

Run on 2026-11-09 with curl as production@ / accounting@ / admin@ on throwaway orders, all removed
afterwards (orders, log rows, approvals, notifications, `prd_number_seq`; counts checked against a
snapshot):

- Complete while approved → 409. Accounting POSTing the endpoint → `/unauthorized`. No body,
  `abc`, `-1` → 400 validation. `0` → 400 "write-off". `20.001` on a 10 kg plan → 400 naming
  20 kg; exactly `20` → accepted. Unknown id → 404.
- `9.6` → 200: `actualQty` 9.6, `completedAt`, `completedById` = production, a log row
  `IN_PROGRESS → PENDING_COMPLETION`, `StockMovement` unchanged. Again → 409 "already reported";
  Start or Cancel → 409.
- A new Dinuguan preview still counts the pending order as committed (Cane Vinegar 0.5).
- Pages: the card for production only; the blue note for accounting; the amber note and violet
  badge while pending; the violet chip on the calendar.
- Yield row: −0.4 kg (96%), +0.35 kg (103.5%), ±0 kg (100%); none on a draft.
- Two completions at once: one 200, one 409, one log row.

## Risks / assumptions / follow-up

- Until Task 2 ships, a completion-pending order has no way forward. A wrong yield cannot be
  corrected yet.
- The ingredients actually used are not entered: Task 2 deducts per BOM at the planned quantity
  (W6-3), so any over- or under-use shows only as yield.
- A run that produced nothing cannot be completed; it waits for Week 7's write-off.
- The 2 × planned cap is a typo guard, not a business rule; adjust `MAX_YIELD_FACTOR` if real
  yields exceed it.
