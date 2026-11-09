# 2026-11-09 — Production completions: accounting sign-off, stock movements and finished goods (Week 6, Task 2)

Week 6 roadmap tasks "On completion: raw materials deducted per BOM, finished goods added to stock"
and "Accounting approves completion", and the rest of "Kitchen supervisor marks production as In
Progress → Completed". Task 1 let the kitchen report a run done with its actual yield
(`PENDING_COMPLETION`). Now accounting signs that report off, or sends it back. Approving moves the
stock in one transaction: every ingredient comes off per the BOM, and the yield goes into a new
finished-goods stock as a **lot**. Finished goods now have their own page.

Built in subtasks 2.1–2.5. Each was verified end to end with curl and then tested by the user in
the browser. Tracker: `docs/week6-task2-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Accounting decides through `POST /api/approvals` with `referenceType: 'ProductionCompletion'` (referenceId = the order). ACCOUNTING + ADMIN; never whoever reported it (`completedById`), ADMIN included; a reason is required to reject | Reuses the one decision endpoint and its guard. Plan and completion decisions stay separate `Approval` rows. |
| D2 | Approve → `COMPLETED` in one transaction: `transition()`, the `Approval` row, one `OUT` per ingredient (pinned BOM at the **planned** quantity, merged per material, written in `materialId` order), then the lot `IN` at the **actual** yield | W6-1: stock moves only on sign-off. "Deducted per BOM" is the roadmap's rule; over- or under-use shows as yield. A fixed write order means two approvals sharing ingredients cannot deadlock. |
| D3 | Stock may go below zero; the approver is warned which ingredients will | The books should not refuse what physically happened. A negative shows a delivery or adjustment that was never recorded. Blocking would mean no run could complete with today's stock. |
| D4 | Reject → `IN_PROGRESS` with the reason; `actualQty`, `completedAt` and `completedById` are cleared. Reporting completion now writes "Yield 9.6 kg" as its log note | One correction path. The append-only log keeps every report. |
| D5 | New `FinishedGoodLot`, `FinishedGoodLevel` (lot + branch) and `FinishedGoodMovement` (signed ledger, NOT NULL reference). `InventoryRepository.stockOut` and `FinishedGoodStockRepository.receiveLot` write ledger and level together | Expiry (Week 7) and transfers (Week 8) need quantities per lot. Folding finished goods into `InventoryLevel` would need partial unique indexes Prisma's upsert cannot use. |
| D6 | Lot number = the order number (PRD-000005); `producedOn` = the Manila date the kitchen reported it done. Expiry is the next task | One run is one lot, and the label leads back to the order. Conversions (Week 7) number their own lots. |
| D7 | `unitCost` stays null on these movements | Costing (next task) decides how it is set. |
| D8 | Order page: the approver sees what approving does (each ingredient: deduct, on hand now, after, negatives in red; the lot coming in) above Approve / Reject. The reporter sees "You reported this completion…". A completed order gets a "Stock moved" card, read back from both ledgers. The timeline shows a sent-back completion | Accounting sees exactly what the books will do before deciding. |
| D9 | Approvals inbox: "Production completions" with yield vs plan, reporter and "N of M go negative" | Same shape as the Production orders section. |
| D10 | New page Inventory → Finished Goods (`/inventory/finished-goods`, every role). The Stock Ledger shows and links PRD numbers. The daily `stock-reconciliation` also checks the finished-goods ledger | Where finished goods "appear" (the Week 6 deliverable). The stock invariant is checked for the new tables too. |
| D11 | Notifications through new queue jobs: `production-completion-reported` → ACCOUNTING + ADMIN minus the reporter; `production-completion-decided` → the reporter | Same rules as Week 5 Task 5. |

## What changed

- *2.1 Schema.* The three finished-goods tables, with back-relations on `FinishedGood`, `Branch` and
  `ProductionOrder` (`lot`). Migration `20261109083000_finished_good_stock`, new tables only.
- *2.2 Decision.*
  - `InventoryRepository.stockOut()` (stockIn's mirror; the level may go negative) and
    `FinishedGoodStockRepository.receiveLot()`.
  - `ProductionOrderRepository.decideCompletion()` (D2 / D4). Its `UPDATE` also matches the report's
    `completedAt`, so a report sent back and re-made while the approver looked at the old one is
    never approved at the old figure.
  - `ProductionOrderService.applyCompletionDecision()`. `complete()` now writes the yield note.
    `/api/approvals` dispatches `ProductionCompletion`. New `isoDateAt()` in `lib/dates.ts`, which
    `todayIsoDate()` now uses.
- *2.3 Approval UI.*
  - `consumptionByMaterial()` is the one source for both the preview and what approval writes.
  - `completionEffect()` and `completionStock()` feed the new `CompletionReview` and `CompletionStock`
    components. The detail DTO gains `completionEffect`, `stockMoved` and `completedById`.
  - `listPendingCompletions()` feeds the inbox. `findPendingWithBom()` now takes the status.
  - Timeline: "In progress" is the start, plus the latest send-back and its reason. Steps not reached
    show no one. A completed order ends all green. "Completed" shows accounting's remark.
  - Found in the user's test: accounting saw only "In the kitchen…" on a sent-back run and looked
    for an Approve button. It now says the completion was sent back and is waiting for production
    to report again.
- *2.4 Finished goods.*
  - `/inventory/finished-goods`: a total per finished good and branch, and lots newest first
    (capped at 500 with a notice), with the lot linking to its order for roles that can open it.
    Sidebar entry. `FinishedGoodStockRepository.findLevels()` and `mismatchedLevels()`;
    `InventoryService.finishedGoodStock()`.
  - Stock Ledger: `ProductionOrder` sources resolve to PRD numbers (`numbersByIds`).
  - `notifyStockMismatches` covers lots.
- *2.5 Notifications.* Job names in `lib/queue.ts`, worker handlers,
  `NotificationService.notifyCompletionReported()` and `notifyCompletionDecided()`. The decided job
  reads the reporter from the status log, because a send-back clears `completedById`. The bell
  links to the order.

## Files affected

- `prisma/schema.prisma`, `prisma/migrations/20261109083000_finished_good_stock/migration.sql` (new)
- `repositories/inventory.repository.ts`, `repositories/finished-good-stock.repository.ts` (new), `repositories/production-order.repository.ts`
- `services/production-order.service.ts`, `services/inventory.service.ts`, `services/notification.service.ts`
- `app/api/approvals/route.ts`, `lib/dates.ts`, `lib/queue.ts`, `lib/navigation.ts`, `worker/index.ts`
- `components/production/CompletionReview.tsx` (new), `components/production/CompletionStock.tsx` (new), `components/production/StatusTimeline.tsx`, `components/procurement/ApprovalActions.tsx`
- `app/(protected)/production/orders/[id]/page.tsx`, `app/(protected)/procurement/approvals/page.tsx`, `app/(protected)/inventory/finished-goods/page.tsx` (new)
- `docs/api.md`, `docs/architecture.md`, `docs/database.md`, `docs/overview.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

## Database changes

Migration `20261109083000_finished_good_stock`: three new tables. Nothing existing is altered. After
applying it:

- run `npx prisma generate`
- restart `npm run dev` and `npm run worker`
- in VS Code, run "TypeScript: Restart TS Server". The editor otherwise keeps the old generated
  types and shows false errors, e.g. "`ProductionStatus` and `"PENDING_COMPLETION"` have no
  overlap"; `tsc` itself is fine.

Data: `InventoryLevel` may now be negative, and `StockMovement` gains `OUT` rows with
`referenceType 'ProductionOrder'`.

## API changes

`POST /api/approvals` accepts `referenceType: 'ProductionCompletion'`. No new endpoint. See
`docs/api.md`.

## UI changes

- Approval preview and Approve / Reject on completion-pending orders; "Stock moved" card; timeline
  changes.
- Inbox: Production completions section.
- New Finished Goods page and sidebar entry; PRD links in the Stock Ledger.
- Four new notification kinds in the bell.

## Configuration / environment

None. The worker must be running for the notifications; it reloads code by itself (`tsx watch`).

## How to verify

```bash
npx tsc --noEmit && npm run lint
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

Run on 2026-11-09 with curl as production@ / accounting@ / admin@ / viewer@ / branch@ on
throwaway Dinuguan orders (PRD-000005 to PRD-000011). Afterwards I deleted them and every row they
created: 43 notifications, 17 approvals, 41 log rows, 77 stock movements, 7 lots with their levels
and movements, and 10 stock levels. Pork Belly was restored to 4 kg with its original `updatedAt`.
`prd_number_seq` is back to 4. All counts match the task-start snapshot, and both ledgers reconcile
with their levels.

- Guards: deciding while in progress → 409; production → `/unauthorized`; admin deciding their own
  report → 403; a reject without a reason or with a blank one → 400; approving twice → 409.
- Reject: back to `IN_PROGRESS`, yield cleared, both reports on the log ("Yield 9.6 kg", then the
  reason), a `ProductionCompletion` approval row, no stock touched.
- Stale report: `decideCompletion` with an older `completedAt` → false, nothing written.
- Approve: `COMPLETED`; 11 `OUT` rows in material order; Pork Belly 4 → 0 and the other ten
  ingredients negative; lot PRD-000005 with 9.8 kg, produced 2026-11-09; completed runs no longer
  count as committed.
- Two approvals at the same instant: one 200, one 409; one set of rows.
- Pages per role: preview card and decision box for accounting; the own-report note for admin; the
  waiting note for production; Stock moved card; send-back on the timeline; inbox section.
- Finished Goods: totals and lots, lot links only for roles that can open orders, branch filter,
  empty state. Ledger PRD links for production, plain numbers for viewer.
- Reconciliation: a lot level briefly set off its ledger was reported by name (restored exactly
  afterwards).
- Notifications with the real worker: report → approvers minus the reporter; send-back and approval
  → the reporter; an admin-reported run → accounting only; bell links to the order.

## Risks / assumptions / follow-up

- Negative stock is allowed and will appear as soon as runs complete without the deliveries being
  recorded. Nothing corrects it yet; stock adjustments are still a known gap.
- Ingredients are deducted at the planned quantity; actual consumption is not captured.
- `unitCost` is null on production movements until costing; lots approved before then will have no
  cost.
- Expiry is not set yet (next task: shelf life per finished good).
- A finished-goods ledger page is not built; the order's Stock moved card and the Finished Goods page
  cover today's needs.
- The inbox runs one stock query per pending completion, like the production-order section.
- Notification jobs are not idempotent (as before).
- RR approval writes level rows in line order, so two RR approvals sharing materials could in
  theory deadlock; production approvals sort to avoid it. Worth the same fix there.
