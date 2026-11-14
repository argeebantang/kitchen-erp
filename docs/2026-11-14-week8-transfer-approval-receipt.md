# 2026-11-14 — Transfer approval and receipt (Week 8, Task 3)

Week 8 roadmap task "Transfer approval by accounting, branch confirms receipt".

A Transfer Order (Task 2) now runs end to end:
1. Accounting approves it, which dispatches it: the lots leave the commissary.
2. The transfer is in transit.
3. The receiving branch's manager confirms it arrived, and the same lots join that branch's stock,
   with their lot number, expiry and cost.
4. Notifications follow each step.
5. End of Day's Distributed column shows the transfer at both ends, with links.

Variance (what arrived vs what was sent) is Task 4.

Built in subtasks 3.1–3.4.
- Claude tested 3.2 and 3.4 at the user's request. The user tested 3.3 (confirmed TRF-000001's
  receipt).
- Test data was prepared and left in place for the user (lots, Cubao / Pasig, TRF-000001–3, a
  Lechon order). Claude's own edge-case transfers were removed after each subtask.
- Everything was deleted in 3.5. Steps are in `docs/week8-task3-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| R1 | Approve = dispatch. Accounting decides through `POST /api/approvals` (`StockTransfer`): never whoever recorded it (ADMIN included), a reason to reject, rejection final. One transaction: lock each line's lots at the sender (goods in id order), re-plan soonest expiry first (expired skipped), 409 if short, one `TRANSFER −` per lot at its cost | Same pattern as write-offs and conversions. Re-checking under the lock closes Task 2's "nothing reserved" gap. |
| R2 | Between approval and receipt the goods are in transit, at neither branch. The page says so | Matches the van on the road. End of Day balances at each branch. |
| R3 | The receiving branch's manager (`Branch.managerId`) or an ADMIN confirms receipt. The same lots arrive as `TRANSFER +`, read from the dispatch movements. `receivedById` / `receivedAt` | Lot identity, expiry and cost travel with the food; an audit trail. |
| R4 | Receipt is all or nothing for now; partial receipt and variance are Task 4 | Roadmap split. |
| R5 | `POST /api/transfers/[id]/receive`. The `/api/transfers` guard adds BRANCH_MANAGER; create and preview re-check ADMIN / PRODUCTION_MANAGER in their routes; receive checks the branch in the service | A prefix guard cannot exclude a sub-path, and receiving needs a per-branch check anyway. |
| R6 | An expired lot is still received, and flagged at the receiver for a write-off there | The books follow the food. |
| R7 | Notifications via the queue: submitted → approvers; approved → recorder + receiving manager; rejected / received → recorder | Like every other document. |
| R8 | Inbox section; Approve / Reject, decision history, Stock moved and Confirm received on the detail page; `SOURCE_PAGES` `StockTransfer`; End of Day numbers + links; bell links | Same as conversions and write-offs. |
| Answers | "do all recommended"; the questions went unanswered, so the defaults stand: the branch's manager or an admin confirms; no kitchen-side cancel (accounting rejects); a dispatched transfer is settled by Task 4's variance | — |

## What changed

- *3.1 Schema and groundwork.*
  - Migration `20261114150000_transfer_receipt`: `StockTransfer.receivedById` (FK `User`,
    `ON DELETE SET NULL`) and `receivedAt`.
  - `FinishedGoodStockRepository.transferIntoLot` puts stock into an **existing** lot at a branch:
    a level upsert-increment plus a `TRANSFER (+)` row. `findMovementsByReference` can read on a
    transaction.
  - The detail data carries the decision history, received by / at, and Stock moved.
  - New `components/inventory/TransferStock.tsx` shows the out side, then "In transit to …" or the
    in side.
- *3.2 Approve / reject.*
  - `StockTransferRepository.decide`, `findPending`; `StockTransferService.applyDecision`,
    `listPending`.
  - `POST /api/approvals` accepts `StockTransfer`.
  - The detail page gets Approve / Reject (not for whoever recorded it) and a blue In-transit
    banner. The pending banner now says that a line short of *available* (after other documents'
    claims) can still be approved if the lots hold it, and is refused if they do not.
  - The approvals inbox gets a Transfers section: value, In stock / Short.
- *3.3 Receipt.*
  - `StockTransferRepository.receive`, `StockTransferService.receive` / `mayReceive`, and
    `canReceive` on the detail.
  - `POST /api/transfers/[id]/receive`.
  - Guard change and role re-checks (R5).
  - `ConfirmReceiptButton` with a confirm dialog. Afterwards: a green "Received at … confirmed by …"
    banner and the in side of Stock moved.
- *3.4 Notifications and links.*
  - Jobs `transfer-submitted`, `transfer-decided`, `transfer-received` and their worker handlers.
  - `NotificationService.notifyTransferSubmitted` / `Decided` / `Received`. Types:
    `TRANSFER_SUBMITTED`, `TRANSFER_APPROVED`, `TRANSFER_DISPATCHED`, `TRANSFER_REJECTED`,
    `TRANSFER_RECEIVED`.
  - The bell links `StockTransfer` to the transfer.
  - `SOURCE_PAGES.StockTransfer` (ADMIN, PRODUCTION_MANAGER, ACCOUNTING, BRANCH_MANAGER) and
    `StockTransferRepository.numbersByIds` give End of Day TRF numbers and links.

## Files affected

- `prisma/schema.prisma`, `prisma/migrations/20261114150000_transfer_receipt/migration.sql` (new)
- `repositories/finished-good-stock.repository.ts`, `repositories/stock-transfer.repository.ts`
- `services/stock-transfer.service.ts`, `services/notification.service.ts`, `services/inventory.service.ts`, `services/end-of-day.service.ts`
- `app/api/approvals/route.ts`, `app/api/transfers/route.ts`, `app/api/transfers/preview/route.ts`, `app/api/transfers/[id]/receive/route.ts` (new)
- `app/(protected)/inventory/transfers/[id]/page.tsx`, `app/(protected)/procurement/approvals/page.tsx`
- `components/inventory/TransferStock.tsx` (new), `components/inventory/ConfirmReceiptButton.tsx` (new), `components/procurement/ApprovalActions.tsx`
- `lib/queue.ts`, `worker/index.ts`, `middleware.ts`
- `docs/api.md`, `docs/architecture.md`, `docs/database.md`, `docs/overview.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

## Database changes

Migration `20261114150000_transfer_receipt`: two nullable columns and a foreign key. Additive. The
model count is unchanged at 29.

## API changes

- `POST /api/approvals` accepts `referenceType: 'StockTransfer'`.
- New: `POST /api/transfers/[id]/receive`.
- `/api/transfers` now admits BRANCH_MANAGER; `POST /api/transfers` and `GET /api/transfers/preview`
  return 403 for anyone but ADMIN / PRODUCTION_MANAGER.

## UI changes

- **Transfer page:** Approve / Reject, decision history, the In-transit and Received banners,
  Confirm received, and the Stock moved card.
- **Approvals inbox:** a Transfers section.
- **Bell:** transfer notifications.
- **End of Day:** TRF numbers, with links.

## Configuration / environment

The generated Prisma client changed: restart `npm run dev`, `npm run worker` and the TS server after
pulling. The worker also gains three job names; under `tsx watch` it reloads on its own, otherwise
restart it.

## How to verify

```bash
npx tsc --noEmit && npm run lint
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

Needs finished-goods lots at a commissary and an outlet with a manager. Then:
1. As production@, record a transfer.
2. As accounting@, from the bell or the inbox, approve it. Stock moved shows the lots out and
   "In transit".
3. As the outlet's manager, from the bell, Confirm received. The same lots appear on Finished Goods
   at the outlet.
4. As production@, check the bell. On End of Day: Distributed − at the sender and + at the receiver,
   with TRF links.

Run on 2026-11-14:
- **Approve / reject:**
  - Approve dispatched soonest-expiry lots as `TRANSFER −` at lot cost.
  - A second decision: 409. Reject without a reason: 400. Rejected: nothing moved, final.
  - Own transfer: 403 (ADMIN included). Production: redirected.
  - A lot expired before approval: 409, nothing written.
  - Two approvals racing for 18 kg Lechon (10 + 10): one approved, one 409 "8 kg unexpired on hand".
- **Receipt:**
  - Same lots, same cost at the receiver.
  - Production 403; accounting and viewer redirected.
  - A branch manager it does not concern: 404. Pending: 409. Repeat: 409 "has already been
    received". Rejected: 409.
  - Two confirmations at once: one 200, one 409.
  - Admin can receive.
  - Branch managers get 403 on create and preview.
- **Ledger:** `transferIntoLot` creates then increments the level; ledger = levels throughout
  (0 mismatches).
- **End of Day:** balanced at all three branches; closing = stock levels.
- **Notifications** through the running worker: every type to the right people, with links.
- **Cleanup:** all test data deleted (4 transfers, 5 lots with levels and movements, PRD-000005,
  Cubao and Pasig, their approvals and notifications); `trf_number_seq` and `prd_number_seq` reset.
  Every count and checksum matches the task-start snapshot.
- **Not covered:** client-side behaviour (confirm dialogs, buttons) was not clicked in a browser
  here; the user confirmed a receipt in the browser.

## Risks / assumptions / follow-up

- **No partial receipt.** Receiving is all or nothing. A shortage (or a dispatched transfer that never
  arrives) waits for Task 4's received quantities and variance.
- **No cancel by the kitchen.** A transfer can only be stopped by accounting rejecting it before
  approval.
- **In transit is invisible.** Between approval and receipt the goods are at no branch. Stock Levels,
  Finished Goods and End of Day closing exclude them. A per-branch "in transit to you" view may come
  with Task 5.
- **Branches with no manager.** Only an admin can receive for them.
- **Lot cost on the movements.** `TRANSFER` rows carry the lot's cost for display. Lot valuation
  still reads the lot's first `IN`, so nothing double-counts.
- **No finished-goods movement list.** There is no movement-by-movement page for finished goods (the
  Stock Ledger is raw materials only). A "Finished Goods Ledger" is a possible follow-up.
