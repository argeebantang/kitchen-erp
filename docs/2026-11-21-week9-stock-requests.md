# 2026-11-21 — Branch stock requests: an outlet orders from a kitchen (Week 9, Task 10)

Task 4 of 4 in the multi-kitchen plan, so the plan is now complete. The owner confirmed (2026-11-20):
- there are several central kitchens
- outlets never cook
- an outlet can order from any kitchen

Until now an outlet's order reached the kitchen by phone or chat, and the Production Manager typed it in as a production
order. Nothing in the system said what each outlet had asked for.

What it gives:
- **The outlet asks.** Its Branch Manager (or an admin) opens Branch Inventory → **Request stock from a kitchen**, or
  Stock Requests → *New request*. They pick any kitchen, the day it is needed and the goods, and get **STR-000001**.
  There is no approval: it goes straight to the kitchen.
- **The cut-off.** Requests for a day are due by **15:00 the day before** (`STOCK_REQUEST_CUTOFF`). A later request is
  accepted but flagged **Late**: the form warns before sending, and the kitchen sees the flag.
- **The kitchen sees the demand.** Stock Requests shows production and admins a **Demand** board: for each day and
  kitchen, each good is totalled across the outlets, with the batches of its recipe that cover it. **Plan production**
  opens a production order already filled in (good, kitchen, date, batches).
- **The kitchen answers.** It either:
  - **plans** the request: what it will send per line, with a required note when it sends less than asked (e.g.
    "pork short"), or
  - **declines** it, with the reason.

  The outlet is notified either way.
- **The kitchen sends.** **Send the delivery** opens the transfer form filled in from the plan and linked to the
  request. Accounting approves it as usual.
- **The receipt closes it.** When the outlet counts the delivery, the request becomes **Fulfilled**, or **Partly
  fulfilled** if anything arrived short of what was asked. If accounting rejects the delivery, the request stays
  Planned and can be sent again.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| S-1 | New `StockRequest` / `StockRequestItem`, numbered `STR-000001` (`str_number_seq`). Statuses: SUBMITTED → PLANNED → FULFILLED / PARTLY_FULFILLED, or DECLINED (final) | A request is not a transfer: it can be cut, declined, or sent again after a rejected delivery |
| S-2 | Asked by the outlet's **Branch Manager** (`Branch.managerId`) or an ADMIN, from an active **outlet** to **any** active **kitchen**. Answered by **production** or an ADMIN | Owner: outlets order from any kitchen, and Production Managers cover every kitchen |
| S-3 | **Late** = submitted at or after `STOCK_REQUEST_CUTOFF` (default 15:00, Manila) on the day before it is needed, or on the day itself. Stored at submission. Allowed, never refused | A hard block would push urgent orders back to the phone. The flag shows who orders late |
| S-4 | **No approval.** Plan: each line 0 ≤ planned ≤ asked, a note required if any line is cut, and planning nothing is refused ("decline it instead"). Decline: a reason is required. Both from SUBMITTED only (guarded in the WHERE) | Owner decision. The outlet always learns why it gets less |
| S-5 | Demand board: open requests needed today or later, per kitchen and day, per good. Planned quantities once planned, asked quantities before. Batches = ⌈total ÷ recipe batch size⌉ | What the kitchen needs to plan a day's runs. The batch count is a suggestion: Plan production pre-fills it and the form still decides |
| S-6 | **Send** = a normal delivery transfer with `stockRequestId`, pre-filled from the plan. Its lines can be changed. The service checks the request is PLANNED, from its kitchen to its outlet, with no other non-rejected delivery | Reuses the transfer's approval, lots and receipt. "One at a time" lets a rejected delivery be sent again |
| S-7 | Fulfilment on **receipt**: compares what arrived per good with what was **asked**. Everything arrived in full → FULFILLED, otherwise PARTLY_FULFILLED. Runs after the receipt commits; a failure is logged and never blocks the receipt | "Partly fulfilled" should reflect cuts, lost-in-transit and short sends alike — what the outlet actually got against what it asked |
| S-8 | Notifications: submitted → production and admins (title starts "Late:" when late); planned (with cuts) or declined → the outlet's manager. Delivery messages are the transfer's own | Each side hears about what needs them |
| S-9 | Pages: Stock Requests list (a Branch Manager sees only their outlet's), New request, request detail with the kitchen's Answer panel. Sidebar entry. Branch Inventory button next to Return | Same shape as Transfers |

## What changed

**Database**:
- migration `20261121120000_stock_requests`:
  - enum `StockRequestStatus`
  - tables `StockRequest` (indexes on `status`, `(kitchenId, neededOn)` and `branchId`) and `StockRequestItem`
    (unique per request and good)
  - `StockTransfer.stockRequestId`, nullable FK, `ON DELETE SET NULL`, indexed
  - sequence `str_number_seq`
- 34 models.

**API**:
- `POST /api/stock-requests` (create)
- `POST /api/stock-requests/[id]/plan`
- `POST /api/stock-requests/[id]/decline`
- `POST /api/transfers` accepts an optional `stockRequestId`.

**Config**: `STOCK_REQUEST_CUTOFF` (24-hour time, default `15:00`; a malformed value fails at startup) is in
`lib/config.ts` and `.env.example`.

**Code**:
- `repositories/stock-request.repository.ts`, `services/stock-request.service.ts` (new).
- `services/stock-transfer.service.ts`:
  - `create` checks `stockRequestId`
  - `receive` fulfils the request
  - summaries carry `stockRequest`
- `repositories/stock-transfer.repository.ts`: `create` stores the link.
- `repositories/finished-good-stock.repository.ts`: `findMovementsByReference` also selects the good's id.
- `services/notification.service.ts`: `notifyStockRequestSubmitted`, `notifyStockRequestDecided`, and the
  `StockRequest` link. `lib/queue.ts` and `worker/index.ts`: two jobs.
- `lib/dates.ts`: `timeOfDayAt`.
- `middleware.ts`: guards for `/inventory/requests` (`/new`: ADMIN and BRANCH_MANAGER) and `/api/stock-requests`.
- `lib/navigation.ts`: Stock Requests.

**UI**:
- New pages: `/inventory/requests` (demand board and list), `/inventory/requests/new` (`StockRequestForm`),
  `/inventory/requests/[id]` (`StockRequestDecision`).
- `LateBadge`, and `StatusBadge` colours for the request statuses.
- The transfer form is pre-filled from `?request=`; the production order form from `?good=&branch=&batches=`.
- Branch Inventory: a "Request stock from a kitchen" button.

## How to test

**Test data Claude prepared** (kept until the task ends, notes "claude test"):
- **Cubao Commissary** (`CUBK`) and **Cubao Outlet** (`CUB`, manager **Pedro Branch**)
- **PRD-000005**: Lechon 20 kg at Main
- **STR-000001** (Late): Lechon 15 + Dinuguan 10. Planned 12 + 0 ("pork short…"), sent as TRF-000001, received →
  **Partly fulfilled**
- **STR-000002**: Lechon 3. Planned; TRF-000002 was **rejected** by accounting; sent again as TRF-000003, received →
  **Fulfilled**
- **STR-000003**: to Cubao Commissary, **Declined** ("closed for repairs")
- **STR-000004** (Late): Lechon 5 for Nov 22, **Submitted**, waiting for you

1. As **Maria Production**, open Stock Requests. The Demand board shows Nov 22 · Main Commissary: Lechon 5 kg (not yet
   answered, late) with *Plan production · 1 × 20 kg*. Click it: the order form opens with Lechon, Main Commissary,
   Nov 22 and 1 batch. Don't save.
2. Open STR-000004 → Answer: set 4, and try Plan.
   - Expected: it asks for a note.
   Add one and plan.
   - Expected: Planned, Will send 4 kg, the note shown. Pedro gets "STR-000004 is planned — with cuts".
3. On STR-000004 → **Send the delivery**.
   - Expected: the transfer form, filled with Main → Cubao Outlet, Lechon 4. Submit.
   As **Liza Accounting**, approve it.
4. As **Pedro**, open Branch Inventory → Cubao Outlet, confirm what arrived (4).
   - Expected: STR-000004 becomes **Partly fulfilled** (asked 5, arrived 4).
5. As Pedro, **Request stock from a kitchen**, for tomorrow.
   - Expected: the Late warning (after 15:00). Send it: the bell of Maria and the Admin says "Late: Cubao Outlet asks
     Main Commissary…".
6. As Maria, decline that request without a reason (refused), then with one.
   - Expected: Pedro sees the reason.

Checked by Claude (2026-11-21) through the API against the running app:
- **Create** — refused:
  - production → 403
  - from a kitchen → 400
  - to an outlet → 400
  - a past day → 400
  - Pedro naming another branch → 404
  - a good twice → 400

  Accepted: the next day after 15:00 → `late: true`; the day after → `late: false`.
- **Plan / decline** — refused:
  - Pedro planning → 403
  - a cut without a note → 400
  - more than asked → 400
  - nothing planned → 400
  - planning twice → 409
  - decline without a reason → 400

  Accepted: planning with a note, and declining with a reason.
- **Send** — refused:
  - a declined request → 409
  - the wrong kitchen or outlet → 400
  - a second send while one is open → 409

  Accepted: after accounting rejected a delivery, the request stayed PLANNED and was sent again.
- **Receipt**: 12 of 15 + 0 of 10 → PARTLY_FULFILLED; 3 of 3 → FULFILLED.
- **Notifications**: SUBMITTED went to production and admin, with "Late:" when late. PLANNED and DECLINED went to Pedro.
  A planned message leaves cut-to-zero lines out ("— none of Dinuguan").
- **Browser screenshots** of every page were sent to the owner. They caught a squeezed line in the request form, now
  fixed.
- `tsc` and `eslint` are clean, with no schema drift.

The owner tested it too: they planned STR-000004 and sent it as TRF-000004.

Cleanup (2026-11-21), all deleted:
- the two test branches
- PRD-000005, with its lot, status log, approvals and cost-variance insight
- the ingredient movements, plus the 8 ingredient levels they had created
- STR-000001–000004 and TRF-000001–000004, with their movements and levels
- 35 notifications

`prd_number_seq`, `trf_number_seq`, `rtn_number_seq` and `str_number_seq` were reset. The `AiCall` spend rows were
kept.

## Risks, assumptions, follow-ups

- **Planned is final.** A plan cannot be edited, and a request cannot be cancelled by the outlet. Add either if it is
  needed in practice.
- **Batches use the recipe's batch size.** The Plan production link rounds up and ignores stock already on hand. The
  kitchen adjusts the form.
- **One delivery per request at a time.** A request is not split across several deliveries.
- **"One open delivery" is checked, not locked.** Two kitchen staff sending the same request at the same moment could
  both create a delivery. Accounting would see two and reject one. A lock (or a partial unique index on non-rejected
  deliveries) can be added if it ever happens.
- **No reminders.** No job reminds the kitchen of unanswered requests close to their day. Week 11's escalation job could
  include them.
- The dev server has to be restarted after `prisma generate` (`docs/database.md` step 5).
