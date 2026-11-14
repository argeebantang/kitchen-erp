# 2026-11-14 — Transfer variance logging (Week 8, Task 4)

Week 8 roadmap task "Transfer variance logging".

Until now a transfer was received all or nothing (Task 3). Now the receiving branch **counts each lot**
that left the commissary:
- What arrived joins its stock.
- Anything short is **lost in transit**: it is recorded with a reason and its value at the lot's cost.
  Accounting sees it on the transfer and on the list, and gets a notification.

Built in subtasks 4.1–4.4.
- The user tested 4.1 and 4.2 in the browser: TRF-000001 received in full, TRF-000002 short.
- Claude tested 4.3 at the user's request.
- Test data was prepared and left in place for the user (lots, the Cubao outlet, TRF-000001–3).
  Claude's own edge-case transfers were removed after each subtask. Everything was deleted in 4.4.
  Steps are in `docs/week8-task4-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| V1 | Count per dispatched lot; Received is pre-filled with what was sent | The lots are what physically travelled; most receipts change nothing. |
| V2 | 0 ≤ received ≤ sent. More than sent is refused as a dispatch miscount | An "over" can only be a counting error at dispatch; it must not create stock. |
| V3 | The shortfall gets no movement: it left the sender and never reached the receiver | Matches the road. Both branches' End of Day still balances. |
| V4 | One reason per transfer: Damaged / spilled, Spoiled, Missing, Other. A note is required for Other | Enough to explain a loss without a form per lot. |
| V5 | Stored on the transfer: `varianceValue`, `varianceReason`, `varianceNotes`, recorded once at receipt. Per-lot detail is derived from the movements. No new table | The movements already hold sent and received per lot. The model count stays 29. |
| V6 | Logged and notified, not approved | The goods are gone either way. Accounting needs to know, not to decide. |
| V7 | A variance card on the transfer; a "Short ₱X" badge, an "arrived short" filter and a total lost on the list | Where accounting looks. |
| V8 | Received 0 is allowed (Missing) | A tray that never arrived is still a receipt. |
| Answers | "do all recommended" | — |

## What changed

- *4.1 Schema and receipt form.*
  - Migration `20261114200000_transfer_variance`: enum `TransferVarianceReason`, and three nullable
    columns on `StockTransfer`.
  - `lib/transfer-variance.ts`: the reasons and their labels. It has no Prisma import, so the client
    form can use it.
  - `components/inventory/TransferReceiptForm.tsx` replaces `ConfirmReceiptButton`. It shows:
    - one row per dispatched lot: Sent, Received (pre-filled), Short, and value lost (estimated)
    - amber rows and a "Lost in transit" total
    - red rows when the count is out of range
    - the reason and note fields when something is short
  - `TransferMovementDto` gains `lotId`, and the summary carries the variance fields.
- *4.2 Receive with quantities.*
  - `POST /api/transfers/[id]/receive` takes `lots[]`, `reason` and `notes`.
  - `StockTransferService.receive` checks the counts against the transfer's `TRANSFER −` rows:
    - every lot is counted, once
    - received ≤ sent
    - a reason when anything is short, and a note for Other
  - `StockTransferRepository.receive`, in one transaction:
    - computes the value lost in Decimal
    - sets status, receiver and variance in one race-safe `UPDATE`
    - moves in only what arrived (a lot counted 0 gets no row)
  - `TransferStock` shows "Nothing arrived at …" when every lot was counted 0.
- *4.3 Display and notifications.*
  - `components/inventory/TransferVariance.tsx`: a Lost in transit card with the value, reason and
    note, and per lot: sent, received, short and value. The Received banner says "it arrived short,
    see below" or "everything sent arrived".
  - The list gets:
    - a "Short ₱X" badge
    - an Arrival filter (`short=1`)
    - "Lost in transit: ₱X at cost, across N transfers" for the current filters, from a
      repository aggregate over every row the filters match, with a "Show them" link
  - `NotificationService.notifyTransferReceived`:
    - The recorder's `TRANSFER_RECEIVED` says "arrived short", with the value, reason and note.
    - New `TRANSFER_VARIANCE` goes to accounting and admins, except whoever confirmed it and the
      recorder.
    - Same `transfer-received` job.

## Files affected

- `prisma/schema.prisma`, `prisma/migrations/20261114200000_transfer_variance/migration.sql` (new)
- `lib/transfer-variance.ts` (new)
- `repositories/stock-transfer.repository.ts`
- `services/stock-transfer.service.ts`, `services/notification.service.ts`
- `app/api/transfers/[id]/receive/route.ts`
- `app/(protected)/inventory/transfers/page.tsx`, `app/(protected)/inventory/transfers/[id]/page.tsx`
- `components/inventory/TransferReceiptForm.tsx` (new), `components/inventory/TransferVariance.tsx` (new), `components/inventory/TransferStock.tsx`, `components/inventory/ConfirmReceiptButton.tsx` (deleted)
- `docs/api.md`, `docs/architecture.md`, `docs/database.md`, `docs/overview.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

## Database changes

Migration `20261114200000_transfer_variance`: one enum and three nullable columns. Additive. Existing
received transfers keep null (no variance recorded). The model count is unchanged at 29.

## API changes

`POST /api/transfers/[id]/receive` now **requires** a body:
- `lots[]` of `{ lotId, received }`
- `reason?`, `notes?`

The response adds `varianceValue`. A request with no body is now a 400. The only caller is the
receipt form.

## UI changes

- **Transfer page:**
  - "Confirm what arrived" form (replaces the one-click button)
  - Lost in transit card
  - banner wording
  - "Nothing arrived" in Stock moved
- **Transfers list:** Short badge, Arrival filter, lost-in-transit total.
- **Bell:** `TRANSFER_VARIANCE`, and short wording on `TRANSFER_RECEIVED`.

## Configuration / environment

The generated Prisma client changed: restart `npm run dev`, `npm run worker` and the TS server after
pulling. No new jobs.

## How to verify

```bash
npx tsc --noEmit && npm run lint
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

Needs an in-transit transfer to an outlet with a manager (see the Task 3 note). Then:
1. As that manager, open it. Change one lot's Received, pick a reason and confirm.
2. The transfer shows Lost in transit with the value at lot cost.
3. The list shows Short ₱X, and Arrival → Arrived short finds it.
4. The bell: the recorder sees "arrived short", and accounting and admins see `TRANSFER_VARIANCE`.

Run on 2026-11-14:
- **Refused** (nothing changed):
  - 400: no body, a negative count, an unknown reason
  - 400: more than sent ("10.5 kg counted but only 10 kg was sent — a dispatch miscount")
  - 400: a lot not on the transfer, a lot counted twice, a dispatched lot not counted
  - 400: short without a reason, Other with a blank note
  - 403: production; 409: already received
- **Short:** Bopis 3 → 2.5 and Dinuguan 1 → 0, Damaged: 200, `varianceValue` 410 (0.5 × ₱420 +
  1 × ₱200). Only 2.5 kg Bopis arrived, at lot cost; Dinuguan got no row.
- **Full, by admin, with a stray reason:** value 0, the reason dropped.
- **All zero:** value 480, "Nothing arrived at …".
- **Race:** two confirmations at once → one 200, one 409, one arrival row.
- **Ledger:** ledger = levels throughout (0 mismatches).
- **Pages:**
  - The card on TRF-000002 (₱360.00, "Damaged / spilled") and TRF-000003 (₱120.00, "Spoiled —
    sour smell"). No card for the pre-Task-4 receipt.
  - The list badges, the Arrived-short filter, and the total (₱480.00 across 2). A branch manager
    sees only their branch's total.
- **Notifications** through the running worker:
  - Recorder: "arrived short … ₱120.00 lost in transit — Spoiled: sour smell".
  - Accounting and admin get `TRANSFER_VARIANCE`. An admin who confirmed it is not told; the
    branch manager is not told.
  - A full receipt sends only the plain message.
- **Cleanup:** every test transfer, lot, level, movement, approval and notification, PRD-000005 and
  the Cubao outlet were deleted; the sequences were reset. Counts and checksums match the task-start
  snapshot.
- **Not covered:** the user clicked the receipt form in a browser; Claude had no headless browser.

## Risks / assumptions / follow-up

- **No correction.** A receipt is final. A miscount at the branch can't be undone in the app; it
  needs a stock adjustment (the roadmap follow-up for raw materials and finished goods).
- **Over-delivery is refused,** not recorded. If the kitchen sent more than the transfer says, the
  extra is a dispatch error to fix at the commissary.
- **The loss is on no branch's End of Day.** It left the sender as Distributed and never arrived.
  The transfer's `varianceValue` is the only record of the peso loss. The Week 8 costing dashboard
  should sum it alongside write-offs ("write-off cost impact per week").
- **Pre-Task-4 receipts** have a null `varianceValue`. In production none existed (Task 3's test
  data was deleted).
- **A lot with no cost** makes the transfer's value null. The list's total says how many such
  transfers it leaves out.
