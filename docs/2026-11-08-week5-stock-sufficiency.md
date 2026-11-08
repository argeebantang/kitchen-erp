# 2026-11-08 — Production orders: stock sufficiency check (Week 5, Task 3)

Week 5 Task 3, "Stock sufficiency check: required vs available per ingredient". Every requirement
line on a production order — on its page and in the form's live preview — now shows what is on
hand at the order's branch, what other approved runs there still need, what is therefore
available, and whether this run is covered ("Enough") or not ("Short X"). Task 4 turns the short
lines into a shortage alert.

Built in subtasks 3.1–3.2. Tracker: `docs/week5-task3-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Available = on hand at the order's branch − committed.** Columns Required · On hand · Committed · Available · Stock | Stock only leaves the shelf when a run completes (Week 6). Without "committed", two approved orders would both count the same kilo. Derived; no reservation table. |
| D2 | Committed = what other `APPROVED` and `IN_PROGRESS` orders at the same branch still need, excluding the order being viewed | Drafts and pending orders may never run (pending can be rejected). An approved order must not count against itself. |
| D3 | Stock as of **now**; expected deliveries (sent POs) and the production date are ignored | "What is on the shelf" — simple and honest. Incoming stock is a later planning feature. |
| D4 | On the order page and in the form preview; the preview takes `branchId` and re-checks when the branch changes | One calculation for both. |
| D5 | Shown for `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `IN_PROGRESS`; hidden for `COMPLETED`, `REJECTED`, `CANCELLED` | Today's stock says nothing about a finished or dead run. |
| D6 | Short = max(required − available, 0) in Decimal; the server also sends `enough` (required ≤ available — exactly enough counts) | The client never compares Decimal strings (a `-0` would read as short). |
| D7 | Nothing is blocked: drafts save regardless of shortages | Planning ahead of deliveries. Whether submitting with shortages is blocked is Task 5's call (recommendation: warn, not block). |
| D8 | Committed is computed by loading the committing orders with their BOM lines in one query and scaling them with the same `scaleOrder()` as the order itself; levels are one query for the branch | Committed and Required cannot be scaled differently. Bounded by the number of approved-but-not-completed runs. |

## What changed

- *3.1 Order page.* `InventoryRepository.levelsAtBranch()` (on hand for a set of materials at a
  branch, absent = 0); `ProductionOrderRepository.findCommittedAtBranch()` (committing orders
  with `bom: { include: bomDetailInclude }`, now exported from `bom.repository.ts`);
  `COMMITTING_STATUSES` in the repository. In `ProductionOrderService`: `scaleOrder()` (Decimal
  per batch / total — the one place an order is scaled), `stockFor()` (on hand, committed,
  available, short, enough), `materialRequirements()` now async and taking an optional
  `{ branchId, excludeOrderId }`; `STOCK_CHECK_STATUSES` gates it on the order page.
  `MaterialRequirementsTable` adds the stock columns and the green / red flag when lines carry a
  check; the order page caption explains the figures.
- *3.2 Form preview.* `branchId` on `GET /api/production-orders/requirements` (required, must be
  an active branch); the response adds `branchName` and per-line `stock`; the form includes the
  branch in the preview query (so a branch change re-checks) and names the branch in the caption.

## Files affected

- `repositories/inventory.repository.ts`, `repositories/production-order.repository.ts`, `repositories/bom.repository.ts`
- `services/production-order.service.ts`
- `app/api/production-orders/requirements/route.ts`
- `components/production/MaterialRequirementsTable.tsx`, `components/production/ProductionOrderForm.tsx`
- `app/(protected)/production/orders/[id]/page.tsx`
- `docs/api.md`, `docs/architecture.md`, `docs/database.md`, `docs/overview.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

## Database changes

None. Reads `InventoryLevel`; no stock was changed for testing.

## API changes

`GET /api/production-orders/requirements` now requires `branchId` and returns `branchName` and
`stock` per line — see `docs/api.md#production-orders`. The only caller is the form, updated in
the same change.

## UI changes

On hand · Committed · Available · Stock columns in the "Materials required" table on the order
page and under the new / edit forms.

## Configuration / environment

None.

## How to verify

```bash
npx tsc --noEmit && npm run lint
```

The only stock is Pork Belly 4 kg at Main Commissary; Dinuguan needs 4 kg per 10 kg batch.
Checked during the build (throwaway orders deleted afterwards, `prd_number_seq` reset): Dinuguan
10 × 1 → Pork Belly Enough (exactly enough), 10.1 → Short 0.04; with another 10 kg order
`APPROVED` or `IN_PROGRESS` → committed 4, available 0, Short 4.04, while that order itself
shows Enough; `PENDING_APPROVAL` / `REJECTED` / `COMPLETED` don't commit; a `COMPLETED` order
hides its stock columns. The preview endpoint returns the same figures; a missing or unknown
`branchId` → 400. Subtask 3.1's manual steps were also run end to end (at the user's request) and
passed.

## Risks / assumptions / follow-up

- Only one branch exists, so switching branch in the form was not tried live; the branch is part
  of the preview query, so a second branch re-checks automatically.
- Committed is 0 until Task 5 lets orders be approved.
- Available can go negative when more is committed than on hand; it is shown as is.
- Expected deliveries are ignored (D3). A "covered once PO-000123 arrives" view could come with
  Week 10's planning features.
- The committing-orders query loads each open order's BOM lines; fine while approved runs are
  few. If that grows, aggregate committed per material in SQL instead.
