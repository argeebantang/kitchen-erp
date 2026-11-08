# 2026-11-08 — Production orders: approval by accounting (Week 5, Task 5)

Week 5 Task 5, "Production Order approval by accounting". Production submits a draft order;
accounting approves or rejects it from the approvals inbox or the order page; the right people
are notified. This also fixes how Task 3 counted a shortage when other approved orders have
already spoken for the stock.

Built in subtasks 5.1–5.4, all tested end to end by Claude at the user's request (see "How to
verify"). Tracker: `docs/week5-task5-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | `POST /api/production-orders/[id]/submit`, `DRAFT → PENDING_APPROVAL`, ADMIN + PRODUCTION_MANAGER; records `submittedById`; the saved values go through the same validation as create/edit first | Same as purchase orders. A draft saved days ago may now have a past date or an inactive branch. |
| D2 | A superseded BOM pin is **refused** at submit ("open Edit and save, then submit"), not switched | What accounting approves must be exactly what the planner last saw. The pin is frozen from submission. |
| D3 | Shortages warn, never block: the Submit card says "N of M ingredients are short — accounting will see the shortage" | Planning ahead of deliveries is normal; the shortfall can be requested (Task 4). |
| D4 | ACCOUNTING + ADMIN decide through `POST /api/approvals` (`referenceType: 'ProductionOrder'`); never whoever submitted it, ADMIN included; a reason is required to reject; `REJECTED` is final | Same rules as PR / PO / RR. The submitter is the one vouching for the plan. |
| D5 | `/production` widened to ACCOUNTING; new guards keep `/production/bom` and `/production/orders/new` to ADMIN + PRODUCTION_MANAGER; `/api/production-orders` unchanged; sidebar shows Production Orders to accounting; the list hides "New Production Order" from non-planners | Accounting reads and decides; it does not plan or touch BOMs. |
| D6 | Approvals inbox: "Production orders" section with a "Short · N of M" / "In stock" badge | The shortage count deferred from Task 4. Two stock queries per pending order, bounded at 100. |
| D7 | Order page: Submit card (drafts, planners); approve / reject for approvers; "You submitted this order…" for the submitter; "waiting for accounting" for planners; decision history; "Submitted by" in the details | Reuses `ApprovalActions` and `DecisionHistory`. |
| D8 | Notifications through the queue: `production-order-submitted` → ACCOUNTING + ADMIN minus the submitter; `production-order-decided` → the submitter (with the reason on a rejection) and, on approval with shortages, PROCUREMENT_MANAGER + ADMIN minus the approver, naming the short ingredients and linking to the pre-filled purchase request | Approval is when a shortage becomes real. A queue failure never fails the user's action. |
| D9 | Task 5 stops at `APPROVED` / `REJECTED`; Task 6 adds start and cancel; completion with stock is Week 6 | Reviewable steps. |

## What changed

- *5.1 Schema.* `ProductionOrder.submittedById` (nullable, FK → `User`, relation
  `ProductionOrderSubmitter`); the existing requester relation is now named
  `ProductionOrderRequester` (a name only — no database change). Migration
  `20261108122903_production_order_submitted_by`: the column and its foreign key, no backfill.
- *5.2 Submit.* `ProductionOrderRepository.submit()` (`updateMany` with `status: DRAFT` **and the
  checked `bomId`** in the `WHERE`, so an edit landing in between submits nothing);
  `ProductionOrderService.submit()`; the route; `ProductionOrderActions` (Submit card with the
  shortage warning and, when the service would refuse, the reason and a disabled button).
- *5.3 Decide.* `ProductionOrderRepository.decide()` (status move then `Approval` row in one
  transaction, false if someone decided first) and `findPendingWithBom()`;
  `ProductionOrderService.applyDecision()` and `listPending()`; `getById` returns `decisions`
  and the submitter; `/api/approvals` dispatches `ProductionOrder`; `ApprovalActions` accepts it;
  guards and sidebar; order page, list page and inbox as in D5–D7. Created and last-saved dates
  now share one cell in the order details to make room for "Submitted by".
- *5.4 Notify.* Job names `PRODUCTION_ORDER_SUBMITTED` / `PRODUCTION_ORDER_DECIDED` and
  `ProductionOrderJob` in `lib/queue.ts`; worker handlers;
  `NotificationService.notifyProductionOrderSubmitted()` / `notifyProductionOrderDecided()` (both
  re-read the order and do nothing if it has moved on); bell links for `ProductionOrder` and
  `ProductionOrderShortfall`. The purchase request pre-fill (Task 4) now also works for
  PROCUREMENT_MANAGER, who reaches it from the shortfall notification.
- *Fix (Task 3's stock check).* A line's shortage was `max(required − available, 0)`. With other
  approved orders over-committing the stock, `available` goes negative and each order's shortage
  included the others' demand — two approved Dinuguan runs each reported Bay Leaf short 0.01 kg
  when each needs 0.005, so procurement would have double-ordered. Now
  `max(required − max(available, 0), 0)`: never more than the order's own requirement.
  `Available` still shows the negative figure. With nothing committed, every figure is
  unchanged.

## Files affected

- `prisma/schema.prisma`, `prisma/migrations/20261108122903_production_order_submitted_by/migration.sql` (new)
- `repositories/production-order.repository.ts`
- `services/production-order.service.ts`, `services/notification.service.ts`
- `app/api/production-orders/[id]/submit/route.ts` (new), `app/api/approvals/route.ts`
- `components/production/ProductionOrderActions.tsx` (new), `components/procurement/ApprovalActions.tsx`
- `app/(protected)/production/orders/[id]/page.tsx`, `app/(protected)/production/orders/page.tsx`, `app/(protected)/procurement/approvals/page.tsx`, `app/(protected)/procurement/requests/new/page.tsx`
- `lib/queue.ts`, `worker/index.ts`, `middleware.ts`, `lib/navigation.ts`
- `docs/api.md`, `docs/architecture.md`, `docs/database.md`, `docs/overview.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

## Database changes

Migration `20261108122903_production_order_submitted_by` — a nullable column and a foreign key;
safe on existing rows. After applying: `npx prisma generate`, restart `npm run dev` **and**
`npm run worker` (the worker needs the new job handlers too).

## API changes

`POST /api/production-orders/[id]/submit` (new); `POST /api/approvals` accepts
`referenceType: 'ProductionOrder'` and returns `{ productionOrder: { id, orderNumber } }`. The
requirements endpoint's `short` uses the corrected formula. See `docs/api.md`.

## UI changes

Submit card and approval controls on the order page; "Submitted by"; Production orders in the
sidebar for accounting; Production orders section in the approvals inbox; four new notification
kinds in the bell.

## Configuration / environment

None new. The worker must be running for the notifications.

## How to verify

```bash
npx tsc --noEmit && npm run lint
```

Run end to end on 2026-11-08 with curl as production@ / accounting@ / admin@ / procurement@ on
throwaway orders, all removed afterwards (orders, approvals, notifications, `prd_number_seq`;
counts checked against a snapshot):

- Access: accounting reads the list (no New button) and an order (no Edit, Submit or Request
  button); `/production/orders/new`, `…/edit` and `/production/bom` → `/unauthorized`;
  procurement → `/unauthorized` on `/production/orders`.
- Submit: card with "10 of 11 ingredients are short…"; accounting → `/unauthorized`; past date →
  400 and a disabled button with the reason; a wrong BOM pin → 409; submit → `PENDING_APPROVAL`
  with `submittedById`; again → 409; PATCH after submit → 409; page shows the waiting note.
- Decide: production → `/unauthorized`; reject without a reason → 400; ADMIN deciding their own
  submission → 403 and "You submitted this order…" on the page; approve → 200; again → 409; reject
  with a reason → stored on the `Approval` row and shown in the history; unknown `referenceType`
  → 400; two approvers at the same instant → one 200, one 409 "decided by someone else just
  now", one `Approval` row.
- Notify (worker): submitted → accounting + admin, not the submitter; approved → submitter;
  rejected → submitter with the reason; approved with shortages → procurement + admin (not the
  approver) with amounts and "+N more"; procurement's link opens the pre-filled request.
- Inbox: the order with "Short · 10 of 11"; "No production orders waiting" once decided.

## Risks / assumptions / follow-up

- `REJECTED` is final, like PR / PO / RR: a rejected plan is re-planned as a new order.
- The inbox runs two stock queries per pending order; fine at today's volume, aggregate in SQL if
  pending orders grow into the hundreds.
- Approving an order whose production date has passed is allowed; Task 6 / Week 6 may want a
  rule.
- Notification jobs are not idempotent: a retried job could notify twice (same as
  `pr-submitted`).
- Shortfall notifications go to every PROCUREMENT_MANAGER and ADMIN (minus the approver); there
  is no assignment of who orders what.
