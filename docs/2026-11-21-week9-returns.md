# 2026-11-21 — Returns: unsold goods from an outlet back to a kitchen (Week 9, Task 9)

Task 3 of 4 in the multi-kitchen plan. The owner confirmed (2026-11-20):
- outlets never cook
- unsold goods go back to a central kitchen, which converts them into another dish

Until now transfers only went kitchen → outlet (Week 8), so unsold lechon had no way back into the system.

What it gives:
- **An outlet's manager sends unsold goods back.** Branch Inventory → **Return unsold goods to a kitchen** (or
  Transfers → *Return to a kitchen*) opens the transfer form in return mode:
  - from their outlet, to any kitchen
  - the lots it takes (soonest expiry first) and their value at cost
- **No approval.** Sending numbers it **RTN-000001** and takes the lots out of the outlet at once. It is **In transit**
  until the kitchen counts it.
- **The kitchen counts what arrived.** Production or an admin uses the same "Confirm what arrived" count as a
  delivery. Anything short is recorded as lost in transit at the lot's cost, and accounting and admins are told.
- **The lots come back unchanged:** same lot number, expiry and cost. A conversion at the kitchen can use them
  straight away (checked: Lechon Paksiw's preview at Main Commissary takes the returned lot).
- Production and admins are notified when a return is sent ("RTN-000001 is on its way to Main Commissary"). The outlet's
  manager is notified when it is counted.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| R-1 | A return is a `StockTransfer` of a new `kind` **RETURN** (deliveries are **DELIVERY**), numbered `RTN-000001` from its own `rtn_number_seq` | It reuses the lot picking, receipt count, lost-in-transit variance, ledger links, Branch Inventory, End of Day and the costing dashboard. A separate RTN number tells the two apart on paper |
| R-2 | Recorded by the **Branch Manager of the sending outlet** (read from `Branch.managerId`, never the token) or an ADMIN. From an active **outlet**, to an active **kitchen** (commissary) — any kitchen | Owner: outlets order from any kitchen, so they can return to any. A kitchen sends a delivery, not a return |
| R-3 | **No approval**: created `APPROVED` (in transit) and dispatched in the same transaction | Owner decision (2026-11-20). The kitchen's count on arrival is the check, and anything short is reported to accounting |
| R-4 | Lines by finished good; lots taken **soonest expiry first**, expired lots never sent (the delivery rule, `planFefoTakes`). The form shows which lots before sending | Unsold stock is the oldest stock. Expired food is a write-off at the outlet, not a return. Choosing lots by hand would add a second picking rule for no gain |
| R-5 | Counted by **production or an ADMIN** (or the kitchen's branch manager, if it has one) | Production Managers cover every kitchen (owner, 2026-11-20). The outlet that sent it cannot count it |
| R-6 | Shown as **IN TRANSIT** (not APPROVED), with a **Return** badge, and return wording on the detail page. Accounting's Approve is refused ("a return — it needs no approval") | Nobody approved it, so "Approved" would mislead |
| R-7 | `dispatch()` is pulled out of `StockTransferRepository.decide` and shared by a delivery's approval and `createReturn` | One lot-locking, short-check and movement path for both |
| R-8 | `StockTransfer.kind` has no lasting default: the migration backfills DELIVERY, then drops the default | Every insert must say which kind it is, as `Branch.type` does (Week 8 B7) |
| R-9 | End of Day and the costing dashboard need no change. Every TRANSFER movement already counts, signed, under "Distributed", so a return is − at the outlet and + at the kitchen, and the day still reconciles. A short return counts as transfer shortfall | Checked against `DAY_FLOWS` |

## What changed

**Database**:
- migration `20261121090000_transfer_returns`:
  - enum `TransferKind` (`DELIVERY`, `RETURN`)
  - `StockTransfer.kind`, NOT NULL with no default (existing rows backfilled to DELIVERY)
  - sequence `rtn_number_seq`
- Still 32 models.

**API**:
- `POST /api/transfers/returns` (ADMIN, BRANCH_MANAGER): records and sends a return.
- `GET /api/transfers/preview?kind=return`: the return form's preview, for the viewer's own outlet.
- `POST /api/transfers/[id]/receive`: a return can now be counted by production.
- `POST /api/approvals` on a return → 409.

**Code**:
- `repositories/stock-transfer.repository.ts`:
  - `dispatch()` is now shared by a delivery's approval and a return
  - `createReturn()` added
  - `create()` sets `kind: DELIVERY`
- `services/stock-transfer.service.ts`:
  - new: `getReturnForm`, `createReturn`, `returnSender`, `checkLines` (the line checks, now shared with `create`)
    and `transferStatusLabel`
  - `preview` takes a kind and the viewer
  - `mayReceive` lets production count a return
  - `openForBranch` decides "Confirm what arrived" per transfer
  - `applyDecision` refuses a return
- `services/notification.service.ts` `notifyReturnSent`, `lib/queue.ts` `RETURN_SENT`, `worker/index.ts` handler.
- `services/branch-inventory.service.ts`: `transfers.canReturn`. `repositories/branch.repository.ts`:
  `findManagedBy` also returns `type`.
- `middleware.ts`: `/inventory/transfers/return` is ADMIN and BRANCH_MANAGER.

**UI**:
- New page `/inventory/transfers/return`: `TransferOrderForm` with `mode="return"`.
- Branch Inventory:
  - a "Return unsold goods to a kitchen" button for the outlet's manager or an admin
  - a "Return" badge on arriving returns
  - "Confirm what arrived" shown per transfer
- Transfers list: a "Return to a kitchen" button and the badge.
- Detail page: IN TRANSIT, the badge, and return wording. Also in `TransferStock`.
- `StatusBadge` takes an optional `label`.

**Config**: none. After pulling, run `npx prisma migrate deploy` and `npx prisma generate`, then restart `npm run dev`
and `npm run worker`.

## How to test

**Test data Claude prepared** (kept until the task ends, all marked "claude test"):
- **Cubao Commissary** (`CUBK`, kitchen) and **Cubao Outlet** (`CUB`, outlet, managed by **Pedro Branch**,
  branch@kitchen.com)
- **PRD-000005**: Lechon 20 kg at Main Commissary, completed and approved, giving lot PRD-000005
- **TRF-000002**: 15 kg delivered Main → Cubao Outlet and received
- **RTN-000001**: 5 kg returned. Production counted 4.8 kg (DAMAGED), so ₱86.33 was lost in transit
- **RTN-000002**: 3 kg returned, **still in transit**, for you to count

Cubao Outlet holds 7 kg of Lechon. Main Commissary holds 9.8 kg, with 3 kg more arriving.

1. Sign in as **Pedro** (branch@kitchen.com / password123). Branch Inventory shows Cubao Outlet with **Return unsold
   goods to a kitchen**. Click it, choose Main Commissary and Lechon, then type 2. The lot PRD-000005, its expiry and
   its value appear. Send it.
   - Expected: a new RTN, **IN TRANSIT** with a Return badge. Cubao Outlet's Lechon drops by 2 kg.
2. Still as Pedro, try 50 kg.
   - Expected: "Not enough at Cubao Outlet…". The To list offers kitchens only.
3. As **Maria Production**, open Branch Inventory → Main Commissary. Arriving lists RTN-000002 (and yours) with
   **Confirm what arrived**. Count RTN-000002 as 2.5 kg and choose a reason.
   - Expected: RECEIVED, Short ₱…, and Main's Lechon grows by 2.5 kg on the same lot.
4. As **Liza Accounting**, open a return.
   - Expected: no Approve buttons.
5. Production → Conversions → New at Main Commissary, Lechon Paksiw.
   - Expected: the source shows lot PRD-000005, including what came back.
6. The bell:
   - Maria and the Admin got "RTN-… is on its way to Main Commissary"
   - Pedro got "…arrived" after the count
   - Accounting got the shortfall

Checked by Claude (2026-11-21), through the API against the running app:
- Production recording a return → 403.
- A return from a kitchen → 400. A return to an outlet → 400. A return over what is on hand → 409.
- Pedro naming another branch → 404 (preview and create).
- Accounting approving a return → 409. Pedro counting his own return → 403.
- RTN-000001 was created APPROVED, with one TRANSFER −5 movement at the outlet.
- Received 4.8 / DAMAGED → variance 86.325. The lot returned to Main with the same expiry and cost.
- RETURN_SENT went to 2 users (production and admin). The receipt notified Pedro, plus accounting and admin for the
  shortfall.
- Deliveries are unchanged after the `dispatch()` refactor: TRF-000002 was recorded, approved and received in full.
- The conversion preview at Main takes 4.8 kg from the returned lot.
- `tsc` and `eslint` are clean, with no schema drift.
- Screenshots of each step were sent to the owner.

The owner tested it too: they received RTN-000002 and sent RTN-000003.

Cleanup (2026-11-21), all deleted:
- the two test branches
- PRD-000005, with its lot, status log, approvals and cost-variance insight
- the ingredient movements, plus the 8 ingredient levels they had created (none existed before)
- TRF-000002 and RTN-000001–000003, with their movements and levels
- 25 notifications

`prd_number_seq`, `trf_number_seq` and `rtn_number_seq` were reset. The 3 `AiCall` spend rows were kept.

## Risks, assumptions, follow-ups

- **No undo.** A return sent by mistake cannot be cancelled. The kitchen counts it as received, and the goods can be
  sent back with a delivery. A "cancel while in transit" action could be added if this happens.
- **Lots are picked automatically, soonest expiry first.** If an outlet has to send back a specific later lot, the form
  cannot do it. The owner can ask for manual lot choice.
- **Who counts a return.** Production Managers count returns at every kitchen. Kitchen-scoped managers would narrow
  `mayReceive`.
- The dev server had to be restarted after `prisma generate` (`docs/database.md` step 5). It held the old client and
  answered 500 on the first delivery.
- Next in the plan: **Task 4, branch stock request**.
