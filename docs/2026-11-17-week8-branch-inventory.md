# 2026-11-17 — Branch Inventory, live (Week 8, Task 5)

Week 8 roadmap task "Each branch has own real-time inventory view".

**Inventory → Branch Inventory** gives every branch its own page:
- what it holds: finished goods by good and lot, and raw materials
- what to use first
- what is on its way to it
- what is waiting for approval

The page **updates itself within about a second** when stock at the branch moves. A branch manager sees only the branch they
manage.

Built in subtasks 5.1–5.4.
- Test data was prepared on 2026-11-14 and kept for the user until 5.4: lots at Main, a Cubao outlet managed by branch@, a
  Pasig outlet, TRF-000001–3.
- Claude tested 5.3 at the user's request. Server side only, see How to verify.
- Steps are in `docs/week8-task5-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| I1 | A new page: `/inventory/branches` (one card per branch) and `/inventory/branches/[code]` (code in any case) | One place per branch. Existing pages already filter by branch, but none puts it all together. |
| I2 | Headline tiles, finished goods grouped by good with lots soonest expiry first, arriving and pending transfers, the raw-material map, links to the branch-filtered pages | What a branch manager needs at the start of a shift. |
| I3 | Push: Redis pub/sub after each stock-moving commit → SSE `/api/inventory/stream` → `router.refresh()` about 1 s after the last signal. Plus a 2-minute refresh, and one on returning to the tab | About 1 s instead of up to 30 s, with no load while nothing moves. The timer covers what changes with time alone: expiry badges, "expires in 28 h". |
| I4 | Every role sees every branch, except BRANCH_MANAGER: only the branch in `Branch.managerId`. Anything else is "not found". The stream uses the same rule | As on Transfers. A code reveals nothing. |
| I5 | The existing pages are unchanged | The new page reuses their reads, so the figures agree. |
| I6 | Peso values shown to every role | As on Finished Goods and Stock Levels today. |
| I7 | Sidebar: first item under Inventory | A branch manager's main page. |
| I8 | Active branches only. Inactive or unknown → not found. A manager with no branch gets a notice | As elsewhere. |
| I9 | No schema change, no new job, no Prisma client change | Everything is already in the data. |
| Answers | "do all recommended" | — |

## What changed

- *5.1 Branch Inventory page.*
  - `services/branch-inventory.service.ts` builds the page from `InventoryService.finishedGoodStock` and `stockMap`, the
    same reads as Finished Goods and Stock Levels.
    - `overview` returns the cards, or which branch a branch manager is sent to (or none).
    - `forBranch(code)` returns null when the branch is unknown, inactive or not the viewer's.
  - Headline:
    - finished goods: value, lots and goods
    - "Use first": lots expired or expiring within 48 h
    - raw materials out or low
    - transfers arriving
  - A negative lot level (a discrepancy) is shown in the list but left out of the counts and the value.
  - Index cards (`BranchHeadline compact`), the branch page, `not-found.tsx`, and a sidebar item.
  - `BranchRepository.findByCode`. `findManagedBy` also returns the code.
- *5.2 Transfers, raw materials, links.*
  - `StockTransferService.openForBranch` returns two lists, oldest first, at most 50 each:
    - in transit to the branch, with the dispatch time and the value that left the sender (one query over the
      `TRANSFER −` rows: `FinishedGoodStockRepository.dispatchedByTransfers`)
    - pending from or to it
  - Shown by `components/inventory/BranchTransfers.tsx`.
    - "Confirm what arrived" for the branch's manager or an admin opens the transfer at the new `#receive` anchor on
      the receipt form.
    - Transfer numbers link only for the roles in `SOURCE_PAGES.StockTransfer`.
  - The branch's raw-material panel reuses `StockMap`.
  - Links: Finished Goods, End of Day, Stock Levels, Stock Ledger and (role-gated) Transfers, each `?branch=<id>`.
- *5.3 Live updates.*
  - `lib/realtime.ts` gains the channel `inventory:changed` `{ branchIds }` on the same subscriber connection.
    - `onInventoryChanged(branchId | null)`: null means any branch, for the index.
    - `signalInventoryChanged(branchIds)` is fire-and-forget: the change is already committed, so a Redis error is
      logged and never fails the request.
  - The services signal after the commit:

    | Action | Branches signalled |
    |---|---|
    | Receiving report approved | its branch |
    | Production completion approved | its branch |
    | Conversion approved | its branch |
    | Write-off recorded or decided (pending write-offs show on the lots) | its branch |
    | Transfer recorded or decided | both branches |
    | Transfer received | the receiving branch |

    These are the only paths that write stock.
  - `GET /api/inventory/stream` is SSE, built like the notifications stream. `BranchInventoryService.mayWatch` applies
    the page's rule.
  - `components/ui/LiveRefresh.tsx`:
    - debounced `router.refresh()`; the 2-minute and back-to-tab refresh
    - a hidden tab drops its connection, and a reconnect catches up
    - backs off to 30 s when the stream is refused
    - shows "· ● live" or "refreshing every 2 min"
- *5.4* This note, the reference docs and the roadmap.

## Files affected

- `services/branch-inventory.service.ts` (new), `services/stock-transfer.service.ts`, `services/receiving-report.service.ts`,
  `services/production-order.service.ts`, `services/conversion-order.service.ts`, `services/write-off.service.ts`
- `repositories/branch.repository.ts`, `repositories/stock-transfer.repository.ts`, `repositories/finished-good-stock.repository.ts`
- `lib/realtime.ts`, `lib/navigation.ts`
- `app/api/inventory/stream/route.ts` (new)
- `app/(protected)/inventory/branches/page.tsx`, `[code]/page.tsx`, `not-found.tsx` (new)
- `components/inventory/BranchHeadline.tsx` (new), `components/inventory/BranchTransfers.tsx` (new), `components/ui/LiveRefresh.tsx` (new),
  `components/inventory/TransferReceiptForm.tsx` (anchor)
- `docs/api.md`, `docs/architecture.md`, `docs/overview.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

## Database changes

None. The model count stays 29. Reads only, plus a `groupBy` and `findMany` over existing indexes:
- `StockTransfer` by status and branch
- `FinishedGoodMovement` by `(referenceType, referenceId)`

## API changes

New `GET /api/inventory/stream?branch=<id>`. See `docs/api.md`. No existing route changed.

## UI changes

- New Inventory → Branch Inventory: the index and one page per branch, both live.
- The transfer page's receipt form can be linked to (`#receive`).

## Configuration / environment

No new environment variables and no Prisma client change.
- **After pulling, restart `npm run dev` once.** The running server keeps its Redis subscriber across hot reloads; the
  old one doesn't know the new channel, so the stream returns 500 until the restart.
- The worker restarts by itself (`tsx watch`).
- Production starts fresh, so this doesn't apply there.

## How to verify

```bash
npx tsc --noEmit && npm run lint
```

1. As an admin, open Inventory → Branch Inventory. You get one card per active branch. Open one.
2. In another window, record a write-off of one of its lots. The first window shows "pending write-off" within about a
   second, without a reload. Reject it: the line disappears.
3. As a branch manager, Branch Inventory opens their branch. Another branch's code shows "Branch not found".

Run on 2026-11-14 and 2026-11-17:
- **Figures:** Main ₱13,090.00 = 6×400 + 8×420 + 5×200 + 3×190 + 12×480; 5 lots of 3 goods; 1 expired, 2 expiring;
  18 materials out of 21. Cubao: TRF-000002 in transit, Lechon 6 kg, ₱2,880.00.
- **Access:**
  - branch@ is redirected to `/inventory/branches/CUB`. MAIN, PSG and an unknown code are 404.
  - Lower-case codes open.
  - A branch manager with no branch gets the notice.
  - The Confirm button shows for admin@ and branch@ only. Transfer links show for admin@, production@, accounting@
    and branch@, not for viewer@ or procurement@.
- **Stream access:**
  - Allowed: admin@ (one branch or all), branch@ for Cubao, viewer@.
  - 404: branch@ for Main or for all, a malformed or unknown id.
  - No session: redirected to login.
- **Live, with five streams open:**
  - The actions: a write-off recorded and rejected, TRF-000004 Main → Cubao recorded and rejected, TRF-000002
    received in full.
  - Cubao, branch@'s Cubao and all-branches each got one event per action (5).
  - Main got 2 (the transfer only). Pasig got 0.
  - After each action the page showed the change: pending write-off on, then off; Awaiting approval 1, then 0; Lechon
    6 kg, ₱4,480.00 and Arriving 0.
- **Cleanup (2026-11-17):** deleted everything the tests created. That includes the Nov 14 End of Day summary, which was
  about the test lots. Also:
  - the 5 test lots, with their levels and movements
  - TRF-000001–4, WO-000001 and PRD-000005
  - their approvals and notifications
  - the Cubao and Pasig outlets

  The `trf`, `prd` and `wo` sequences were reset. Counts and checksums match the task-start snapshot.
- **Not covered by Claude:** the browser refreshing itself. There is no usable browser here: the cached headless
  Chromium lacks system libraries.

## Risks / assumptions / follow-up

- **Reads per refresh.** A refresh re-runs the page's reads: lots for one branch (capped at Finished Goods' limit), the
  stock map, and two capped transfer lists. Bursts are debounced to one refresh per page. The index reads every branch's
  lots, up to the same cap, with a notice when capped.
- **Signals are fire-and-forget.** A missed signal is caught by the 2-minute refresh. Signals carry branch ids only, and
  each page reads its figures itself.
- **Long-running server needed** for SSE, as for the notification bell. Each open page holds one connection; a hidden
  tab holds none.
- **Not signalled:** master-data changes such as a material's reorder point or a new material. They show on the next
  timed refresh.
- **The costing dashboard** (the last Week 8 task) should sum `StockTransfer.varianceValue` alongside write-offs.
