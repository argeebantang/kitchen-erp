# 2026-11-12 — Write-offs: finished goods that cannot be used or converted (Week 7, Task 2)

Week 7 roadmap tasks "Write-off workflow: items that cannot be converted", "COSTING: write-off cost =
quantity × unit cost of finished good" and "Write-off approval by accounting".

Cooked food that expires, spoils or is dropped is thrown away. Until now the system kept counting it.
Production can now **write off** part or all of a finished-goods lot, with a reason. Accounting
approves it, which takes it out of stock and records the **peso value lost** at what the lot cost to
make.

Built in subtasks 2.1–2.5. Each was verified with curl, SQL and the rendered pages; the user tested
them in the browser, and 2.2 was tested by Claude at the user's request. Tracker:
`docs/week7-task2-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| W1 | Finished-goods lots only; raw-material write-offs come later with stock adjustments | The roadmap's cost rule is the finished good's unit cost; lots already carry cost and expiry. |
| W2 | One write-off = one lot at one branch: quantity (part of a lot allowed), reason, notes. New `WriteOff` (`WO-000001`, `wo_number_seq`); costs recorded at approval | How lots are handled everywhere; about 3 clicks from the lot. A "write off all expired" sweep can come later. |
| W3 | Fixed reasons: Expired · Spoiled (before expiry) · Damaged (dropped, contaminated) · Failed quality · Other (note required). Expired is pre-selected for an expired lot | Week 10's Waste Pattern Detector and Week 11's Waste report need categories, not free text. |
| W4 | Recording submits it (no draft); accounting approves or rejects, never the recorder (ADMIN included), a reason to reject, rejection final. Approve = one transaction: lock, recheck the lot holds the quantity (409 if not), one `WASTE` movement, cost recorded | The roadmap's approval by accounting. As with conversions, it checks the record before stock and cost change, and nothing can be corrected afterwards yet. |
| W5 | Submit: quantity ≤ the lot at the branch − other pending write-offs of that lot. Conversions' "available" also subtracts pending write-offs of unexpired lots | A write-off and a conversion cannot count the same kilo; approval rechecks under lock. |
| W6 | Cost = quantity × the lot's recorded cost per unit (its `IN` movement), recorded at approval on the write-off and its `WASTE` movement | The roadmap's rule. A CNV lot's cost already includes the Lechon it was made from. |
| W7 | ADMIN + PRODUCTION_MANAGER record; ACCOUNTING reads and decides; branch managers with Week 8 transfers | Only the commissary holds finished goods today. |
| W8 | Inventory → Write-offs (list with the value written off, status and reason filters; detail with Approve / Reject); "Write off" on each Finished Goods lot; inbox section; notifications both ways | "Write-offs logged with peso value impact" is in the Week 7 deliverable. |
| W9 | Not in this task: runs abandoned mid-cooking or with zero yield, material write-offs, 24/48 h expiry flags (Task 3), end-of-day reconciliation (Task 4) | Keeps the task to the three roadmap items. |

## What changed

- *2.1 Schema.* `WriteOff`, `WriteOffReason`, `WriteOffStatus`, `wo_number_seq`. Migration
  `20261112150000_write_offs`, additive only.
- *2.2 Record.*
  - `WriteOffRepository` (`create`, `findById`, `findMany` with the approved value, `pendingOnLot`,
    `pendingOnUnexpiredLots`) and `FinishedGoodStockRepository.findLotAtBranch`.
  - `WriteOffService` (`WRITE_OFF_REASONS` with labels, `getForm`, `create`, `list`, `getById`).
  - `POST /api/write-offs`.
  - Pages `/inventory/write-offs` (list, `new?lot=&branch=`, `[id]`, not-found) and a sidebar entry.
  - Components `WriteOffForm` and `WriteOffReasonBadge`.
  - A Write off button per lot on Finished Goods (the lot DTO gains `lotId`).
  - Middleware guards.
  - Conversions' pending claim adds pending write-offs of unexpired lots.
- *2.3 Approval.*
  - `WriteOffRepository.decide`: one transaction; a short lot rolls back via `WriteOffConflict`.
  - `findPending`.
  - `FinishedGoodStockRepository.takeFromLot` takes an optional movement type (`WASTE`).
  - `WriteOffService.applyDecision` and `listPending`, plus the detail's `effect`, `decisions` and
    `stockMoved`.
  - `/api/approvals` dispatches `WriteOff`; `ApprovalActions` accepts it.
  - The detail page gets the preview, decision box, history and Stock moved card. New Write-offs
    section in the inbox.
  - Fixed while testing: a rejected write-off's value was labelled "Value (estimate)"; it now reads
    "Value: None — rejected".
- *2.4 Notifications and links.*
  - Jobs `write-off-submitted` and `write-off-decided`, with worker handlers.
  - `NotificationService.notifyWriteOffSubmitted` / `notifyWriteOffDecided`, and bell link `WriteOff`.
  - Finished Goods lots show "N kg pending write-off" (`WriteOffRepository.pendingByLot`).

## Files affected

- `prisma/schema.prisma`, `prisma/migrations/20261112150000_write_offs/migration.sql` (new)
- `repositories/write-off.repository.ts` (new), `repositories/finished-good-stock.repository.ts`
- `services/write-off.service.ts` (new), `services/inventory.service.ts`, `services/conversion-order.service.ts`, `services/notification.service.ts`
- `app/api/write-offs/route.ts` (new), `app/api/approvals/route.ts`
- `app/(protected)/inventory/write-offs/page.tsx`, `new/page.tsx`, `[id]/page.tsx`, `not-found.tsx` (all new)
- `app/(protected)/inventory/finished-goods/page.tsx`, `app/(protected)/procurement/approvals/page.tsx`
- `components/inventory/WriteOffForm.tsx`, `components/inventory/WriteOffReasonBadge.tsx` (new); `components/procurement/ApprovalActions.tsx`, `components/production/ConversionEffect.tsx`
- `middleware.ts`, `lib/navigation.ts`, `lib/queue.ts`, `worker/index.ts`
- `docs/api.md`, `docs/architecture.md`, `docs/database.md`, `docs/overview.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

## Database changes

Migration `20261112150000_write_offs`:

- **New table `WriteOff`**, with indexes on `status`, `(lotId, status)` and `branchId`.
- **Enums** `WriteOffReason` and `WriteOffStatus`.
- **`wo_number_seq`.**

Nothing existing is altered; the schema has 29 models. After applying it: `npx prisma generate`,
restart `npm run dev` and `npm run worker`, and in VS Code run "TypeScript: Restart TS Server".

`FinishedGoodMovement` now gets `WASTE` rows (`referenceType 'WriteOff'`). The `MovementType` value
existed but was unused.

## API changes

New `POST /api/write-offs`. `POST /api/approvals` accepts `referenceType: 'WriteOff'`. See
`docs/api.md`.

## UI changes

- **Inventory → Write-offs** (sidebar): the list and the detail page.
- **Finished Goods**: a Write off button per lot, and a "pending write-off" note.
- **The form**, pre-filled from the lot.
- **Approvals inbox**: a Write-offs section.
- **Bell**: three new notification kinds.

## Configuration / environment

None. The worker must run for the notifications.

## How to verify

```bash
npx tsc --noEmit && npm run lint
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

Run on 2026-11-12 with curl as production@ / accounting@ / admin@ / viewer@, SQL and the rendered
pages. Test data: two real Lechon runs through the full production flow (PRD-000005 19 kg, and
PRD-000006 6 kg with its expiry moved to yesterday).

- **Record.**
  - Buttons: two for production, red on the expired lot; none for accounting or viewer.
  - The expired lot's form showed Expired, 6 kg on hand and ₱1438.75/kg, with Expired pre-selected.
  - Refused: accounting / viewer, 0, more than the lot has, more than is left after pending
    write-offs, an unknown reason, Other without a note, a bad branch, an unknown lot.
  - Conversions counted pending write-offs of unexpired lots (16 kg available of 19), and a 17 kg
    conversion was refused.
  - Nothing moved in stock.
- **Approve.**
  - Refused: production (→ `/unauthorized`), admin's own (403), no or blank reason (400), unknown id
    (404).
  - Two simultaneous approvals → one 200, one 409.
  - SQL: one `WASTE` movement of −3 kg at ₱454.342105/kg; totalCost ₱1363.03 = 3 × the lot's cost;
    the lot at 16 kg; ledger and levels reconcile.
  - With the lot briefly at 0.5 kg: the inbox showed "Lot short", the page warned, and approving was
    refused with nothing written.
  - A rejection is final and shows its reason.
  - The list's "Written off" counts approved write-offs only.
  - The user approved WO-000001 (4 kg expired, ₱5,755.00) in the browser.
- **Notifications** (real worker):
  - recorded by production → accounting + admin; recorded by admin → accounting only
  - approved → the recorder, with the value; rejected → the recorder, with the reason
  - bell links open the write-off
  - the "pending write-off" note appears on the lot (a link only for roles that can open the list)
    and clears once decided
- **Cleanup.** Afterwards every test row was deleted: 2 production orders, 2 write-offs (the user's,
  on the test lot), 19 notifications, 6 approvals, 10 status changes, 2 lots with their levels and 4
  movements, 16 stock movements and 8 stock levels. `prd_number_seq` is back to 4 and `wo_number_seq`
  is unused. All counts match the task-start snapshot, with Pork Belly at 4 kg and its original
  `updatedAt`.

## Risks / assumptions / follow-up

- Raw materials cannot be written off yet. That waits for stock adjustments, which would also correct
  negative stock.
- One lot per write-off; a "write off every expired lot" sweep would help at the end of the day (Task
  4's reconciliation may want it).
- An approved write-off cannot be reversed (no approval reversal anywhere yet).
- Pending write-offs claim stock only through the checks at submit. Approval takes whatever the lot
  holds then, and refuses if short.
- Runs abandoned mid-cooking or with zero yield are still not covered.
- There is no finished-goods ledger page; the write-off's Stock moved card and Finished Goods show the
  movement.
- The 24 / 48 h expiry flags are next (Task 3).
