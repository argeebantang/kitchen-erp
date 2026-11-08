# 2026-11-08 — Production orders: status flow, start, cancel and timeline (Week 5, Task 6)

Week 5 Task 6, "Status flow: Draft → Pending → Approved → In Progress → Completed". After Task 5 an
order could reach `APPROVED` or `REJECTED` and stop there. Production can now start an approved run
and cancel an order (with a reason) before it starts; every status change is logged, and the order
page shows the whole flow as a timeline with who moved it and when. Completing a run — which must
deduct the ingredients and add the finished goods — is Week 6.

Built in subtasks 6.1–6.3, all tested end to end by Claude at the user's request. Tracker:
`docs/week5-task6-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Task 6 = Start (`APPROVED → IN_PROGRESS`), Cancel, and the timeline. Complete stays in Week 6 | Completing without moving stock would leave cooked ingredients on the books. Week 6's first roadmap task is marked partial: only Complete remains. |
| D2 | New append-only `ProductionStatusChange` table, written in the same transaction as every status change (submit, approve / reject, start, cancel; Week 6's complete). Creation comes from the order row; no backfill | One timeline and audit trail instead of ~6 more columns (`submittedAt`, `startedAt`/`By`, `cancelledAt`/`By`/`Reason`), with more to come in Week 6. No order had left `DRAFT` when it was added. |
| D3 | Start: `POST …/[id]/start`, ADMIN + PRODUCTION_MANAGER, race-safe; shortages warn, never block | Same rule as submit. Stock records may lag behind deliveries; the kitchen sees the shelf. |
| D4 | No date rule on start; the timeline notes a start before the production date | Kitchens prep the day before; the record keeps it honest. |
| D5 | Cancel: `POST …/[id]/cancel` with a required reason, ADMIN + PRODUCTION_MANAGER, from `DRAFT`, `PENDING_APPROVAL` or `APPROVED` — not `IN_PROGRESS` | Once cooking has started, stopping needs a write-off (Week 7). Cancelling an approved order frees its committed stock automatically (committed counts only `APPROVED` / `IN_PROGRESS`). |
| D6 | Timeline on the order page: Draft → Pending approval → Approved → In progress → Completed with who · when (Manila time); red ending for Rejected / Cancelled with the remarks / reason | The status flow made visible. It replaces `DecisionHistory` on this page (decisions and their remarks are in the log). |
| D7 | No new notifications | Small task; "cancelled after approval → tell procurement" can follow. |

## What changed

- *6.1 Status log.* `ProductionStatusChange` model + migration `20261108133119_production_status_change`
  (new table, index on `(productionOrderId, createdAt)`, FKs to the order and the user).
  `transition()` in `production-order.repository.ts` is now the one way an order's status changes:
  `updateMany` with the expected status (plus optional extra conditions, e.g. submit's `bomId`) in
  the `WHERE`, and the log row only when a row matched — on the caller's transaction. `submit` and
  `decide` use it (submit now runs in a transaction too); `findStatusChanges()` reads the log.
- *6.2 Start and Cancel.* `ProductionOrderRepository.start()` / `cancel()` (cancel passes the
  status the service read as `from`, so a concurrent change makes it a no-op);
  `ProductionOrderService.start()` / `cancel()` with `CANCELLABLE_STATUSES`; the two routes (cancel
  validates `reason` with zod). `ProductionOrderActions` is now one card for `kind="submit"` and
  `kind="start"`; new `CancelProductionOrder` (button + `Modal` asking the reason). The order page
  shows the Start card on approved orders, Cancel beside Edit, and an "In the kitchen" note while in
  progress.
- *6.3 Timeline.* New `StatusTimeline` (Server Component) from `statusChanges` in the detail DTO.
  The DTO's `decisions` field (Approval rows) was dropped — the timeline shows decisions from the
  log — and `DecisionHistory` is no longer used on this page.
- Wording: "This order is still a draft — only an approved order can be started"; "This order is
  already cancelled".

## Files affected

- `prisma/schema.prisma`, `prisma/migrations/20261108133119_production_status_change/migration.sql` (new)
- `repositories/production-order.repository.ts`, `services/production-order.service.ts`
- `app/api/production-orders/[id]/start/route.ts`, `app/api/production-orders/[id]/cancel/route.ts` (new)
- `components/production/ProductionOrderActions.tsx`, `components/production/CancelProductionOrder.tsx` (new), `components/production/StatusTimeline.tsx` (new)
- `app/(protected)/production/orders/[id]/page.tsx`
- `docs/api.md`, `docs/architecture.md`, `docs/database.md`, `docs/overview.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

## Database changes

Migration `20261108133119_production_status_change` — a new table only; nothing existing is
altered. After applying: `npx prisma generate`, restart `npm run dev` and `npm run worker`.

## API changes

`POST /api/production-orders/[id]/start` and `POST /api/production-orders/[id]/cancel` (new). No
change to existing endpoints' shapes. See `docs/api.md`.

## UI changes

Status timeline on the order page; Start card; Cancel button with a reason dialog; in-progress note.

## Configuration / environment

None.

## How to verify

```bash
npx tsc --noEmit && npm run lint
```

Run end to end on 2026-11-08 with curl as production@ / accounting@ / admin@ / procurement@ on
throwaway orders, all removed afterwards (orders, log rows, approvals, notifications,
`prd_number_seq`; counts checked against a snapshot):

- Happy path: submit → approve → start writes three log rows with the right people; the
  timeline shows each step with who · when and "Started on …, before its production date".
- Start: from a draft → 409; accounting → `/unauthorized`; twice → 409; Start card shows "11 of
  11 ingredients are short … you can still start"; no Start / Cancel for accounting.
- Cancel: draft, pending and approved orders with a reason → `CANCELLED`, reason on the log and
  in red on the timeline; blank reason or no body → 400; procurement → `/unauthorized`; again →
  409 "already cancelled"; in progress or rejected → 409. A cancelled pending order leaves the
  inbox and deciding it → 409. Cancelling an approved order dropped another order's committed
  Pork Belly from 8 to 4.
- Reject: red "Rejected" ending with the remarks.
- Race: start and cancel on the same approved order at once → cancel 200, start 409, no
  `IN_PROGRESS` row in the log.
- Task 5 regression: submitted / approved / rejected / shortfall notifications still written.

## Risks / assumptions / follow-up

- Edits are not logged — the log is about status, not field changes.
- Orders already past `DRAFT` before this migration would have no log rows; there were none. The
  timeline falls back to the order row for who submitted.
- Cancelling an approved order notifies nobody; procurement may already have ordered its
  shortfall.
- Week 6's Complete must go through `transition()` so the log stays complete.
