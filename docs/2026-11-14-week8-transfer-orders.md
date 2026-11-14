# 2026-11-14 — Transfer Orders (Week 8, Task 2)

Week 8 roadmap task "Transfer Order: kitchen selects finished goods + quantities to send".

The kitchen can now record what it sends from a commissary to a branch: a Transfer Order, `TRF-000001`,
with one line per finished good. While the kitchen fills it in, the form shows:
- what the commissary can send of each good
- which lots each line will take, soonest to expire first
- what the goods are worth at cost

Saving it submits it to accounting.

**No stock moves yet.** These come next:
- Approval, dispatch and the branch confirming receipt (Task 3).
- Transfer variance (Task 4).

Built in subtasks 2.1–2.4.
- Claude tested 2.1 at the user's request.
- For 2.3 and 2.4, Claude prepared test data and left it in place for the user's own testing: lots,
  two outlets, three transfers and a Lechon order.
- In 2.5, before this commit, all of it was deleted and the sequences reset.

Steps and results are in `docs/week8-task2-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| T1 | This task is the Transfer Order document: create, list, detail. Saving submits it to accounting. No stock moves | The roadmap splits recording, approval / receipt and variance into separate tasks. |
| T2 | `TransferStatus`: `PENDING_APPROVAL → APPROVED` (dispatched: `TRANSFER −` at the sender) `→ RECEIVED` (`TRANSFER +` at the receiver), or `REJECTED`. Only the first is used now | Settled once, so Task 3 adds behaviour, not schema. End of Day balances at both branches. |
| T3 | Reshape the empty, unused Week 1 `StockTransfer` / `StockTransferItem` in place (they held raw materials) | No data to keep. The model count stays 29, and the docs already described `StockTransfer`. |
| T4 | ADMIN and PRODUCTION_MANAGER record transfers; ACCOUNTING reads all; a BRANCH_MANAGER sees only transfers to or from the branch they manage | "The kitchen selects". The branch filter is enforced in the service, and reads `Branch.managerId`, not the token. |
| T5 | From an active commissary to any other active branch | Uses Task 1's branch type. |
| T6 | No draft: saving submits. One line per finished good, quantity > 0. Rejection will be final | Same as conversions and write-offs. |
| T7 | Lots chosen automatically: soonest expiry first, never an expired lot. Shown on the form and the detail page; fixed when stock moves (Task 3) | Same food-safety rule as conversions, and nobody has to pick lot numbers. |
| T8 | A line ≤ the sender's unexpired stock − pending conversions − pending write-offs of unexpired lots − other pending transfers. Conversions also count pending transfers | Two documents cannot promise the same Lechon. Nothing is reserved; approval re-checks. |
| T9 | Open transfers (pending or in transit, at either end) block branch deactivation | Follow-up from Task 1. |
| Answers | "do all recommended"; the questions went unanswered, so the defaults stand: commissary → any other branch, soonest-expiry lots, the kitchen prepares transfers | — |

## What changed

- *2.1 Schema and list.*
  - Migration `20261114090000_transfer_orders`. New enum `TransferStatus`.
  - `StockTransfer` gains `transferNumber` (unique), `status`, `submittedById` and `updatedAt`, and
    loses `transferredAt`.
  - `StockTransferItem` swaps `materialId` for `finishedGoodId`, with one line per good
    (`@@unique`) and cascade delete from the transfer.
  - Indexes on `status`, `fromBranchId` and `toBranchId`; sequence `trf_number_seq`.
  - Two CHECKs: `quantity > 0` and from ≠ to.
  - The migration adds `NOT NULL` columns directly, so a `DO` block aborts it if either table has
    rows.
  - New `repositories/stock-transfer.repository.ts`, `services/stock-transfer.service.ts`, and
    `BranchRepository.findManagedBy`.
  - Inventory → **Transfers** page.
  - Sidebar and guard: the page for ADMIN, PRODUCTION_MANAGER, ACCOUNTING and BRANCH_MANAGER;
    `/inventory/transfers/new` and `/api/transfers` for ADMIN and PRODUCTION_MANAGER.
    `StatusBadge` gains `RECEIVED`.
- *2.2 New transfer.*
  - `/inventory/transfers/new` (`components/inventory/TransferOrderForm.tsx`):
    - From: active commissaries. To: every other active branch.
    - Lines: a finished good and a quantity; add and remove, up to 30.
    - Notes.
  - A live preview from `GET /api/transfers/preview` shows, per line:
    - **Available:** unexpired on hand − claimed, with "on hand · claimed · expired"
    - **Lots it takes:** soonest expiry first, with expiry badges
    - **Value:** at each lot's cost, plus a total
    - a red "Short X" when the line asks for more than is available
  - `POST /api/transfers` records it as `PENDING_APPROVAL` and opens its page. It refuses:
    - a sender that is not an active commissary
    - the same branch on both sides, or an inactive receiver
    - a good on two lines
    - quantity ≤ 0
    - an inactive good
    - over-asking (409, every short line named)
- *2.3 Detail and filters.*
  - `/inventory/transfers/[id]` shows:
    - number and status, from → to, who recorded it and when, notes
    - while pending: each line's available stock (its own claim left out), the lots approving now
      would take, their value and a total
    - a red banner and rows when the sender no longer has enough
  - A branch manager opening another branch's transfer gets "Transfer not found".
  - The list links each number and filters by status and branch (from or to). The branch filter is
    hidden for branch managers.
- *2.4 Claims.*
  - Conversions' available source also subtracts pending transfers. The preview and the error now
    say "claimed by conversions, write-offs or transfers awaiting approval".
  - `BranchRepository.deactivationBlockers` counts transfers that are `PENDING_APPROVAL` or
    `APPROVED`, from or to the branch.

## Files affected

- `prisma/schema.prisma`, `prisma/migrations/20261114090000_transfer_orders/migration.sql` (new)
- `repositories/stock-transfer.repository.ts` (new), `repositories/branch.repository.ts`
- `services/stock-transfer.service.ts` (new), `services/conversion-order.service.ts`, `services/branch.service.ts`
- `app/api/transfers/route.ts`, `app/api/transfers/preview/route.ts` (new)
- `app/(protected)/inventory/transfers/page.tsx`, `new/page.tsx`, `[id]/page.tsx`, `not-found.tsx` (new)
- `components/inventory/TransferOrderForm.tsx` (new), `components/production/ConversionEffect.tsx`, `components/procurement/StatusBadge.tsx`
- `lib/navigation.ts`, `middleware.ts`
- `docs/api.md`, `docs/architecture.md`, `docs/database.md`, `docs/overview.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

## Database changes

Migration `20261114090000_transfer_orders`, as described above. Both tables were empty and nothing read
them. The model count is unchanged at 29.

## API changes

- New: `POST /api/transfers`, `GET /api/transfers/preview`. See `docs/api.md`.
- New guard: `/api/transfers`, ADMIN and PRODUCTION_MANAGER.
- `POST /api/conversion-orders` now also counts pending transfers against the source.

## UI changes

- **Inventory → Transfers:** list, New transfer form and detail page.
- **Conversions:** the wording for claimed stock now names transfers.
- **Master Data → Branches:** deactivation messages list open transfers.

## Configuration / environment

None. The generated Prisma client changed, so `npm run dev`, `npm run worker` and the TS server need a
restart after pulling this.

## How to verify

```bash
npx tsc --noEmit && npm run lint
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

Needs finished-goods lots at Main Commissary (approve a production completion) and an outlet (Master
Data → Branches). Then, as production@:
1. **Transfers → New transfer:** choose an outlet and a good. Check the lots and value, ask for more
   than is available (red, Submit disabled), then submit.
2. Open the new transfer. Then, as branch@ managing that outlet, see it; as branch@ managing a
   different branch, get "Transfer not found".

Run on 2026-11-14:
- **Test lots:** Bopis 10 kg (₱400/kg, within 48 h) and 8 kg (₱420/kg); Dinuguan 5 kg (₱200/kg) and
  3 kg already expired; Lechon 18 kg (₱480/kg).
- **Preview:**
  - Bopis 12 took the sooner lot's 10 kg, then 2 kg of the other = ₱4,840.
  - Dinuguan skipped the expired lot.
  - Bopis 20 was short 2.
- **Create:**
  - TRF-000001 (Bopis 12, Dinuguan 5) was created.
  - Bopis 7 was then refused: "6 kg available (18 unexpired on hand, 12 claimed by documents
    awaiting approval)". Exactly 6 passed.
  - Every validation case was refused, and accounting and branch managers are redirected.
- **Database constraints:** a second line for the same good, a zero quantity and from = to were all
  refused.
- **Detail page:** pending shows lots and value with its own claim left out; non-pending shows goods
  only.
- **Branch managers:** one with no branch sees a notice; one managing Cubao sees only Cubao's
  transfers and gets "not found" for Pasig's.
- **Filters:** by status and branch, with unknown values ignored.
- **Conversions:** a conversion of 10 kg Lechon with TRF-000003 holding 10 of 18 kg showed 8
  available; submitting was refused with the new wording.
- **Deactivation:**
  - Cubao, Pasig and Main were refused with their transfers listed.
  - With a transfer temporarily `APPROVED` the branch was still blocked; with it `RECEIVED`, it was
    not. The rows were restored exactly.
- **Cleanup:** 3 transfers, 5 lots with their levels and movements, PRD-000005, 2 branches.
  `trf_number_seq` and `prd_number_seq` reset. Branch and ProductionOrder checksums and every count
  match the task-start snapshot.
- **Not covered:** the form's client-side behaviour was not clicked in a browser here (no headless
  browser available); the user tested the pages.

## Risks / assumptions / follow-up

- **Nothing reserved.** Two transfers saved at the same moment can both pass the availability check.
  Approval (Task 3) must lock the sender's lots (`lockLots`, the conversion / write-off lock order),
  re-plan soonest-expiry-first and refuse when short.
- **Lots move on approval.** Lots are planned, not stored, until stock moves. The lots shown on a
  pending transfer can change if another document takes them first.
- **Write-offs vs transfers.** A pending write-off and a pending transfer can both count on the same
  lot. Whichever is approved second is refused if the lot no longer covers it.
- **Approving is Task 3.** Accounting has no Approve / Reject yet, and no inbox section or
  notifications.
- **Task 3 must also:**
  - move stock as `TRANSFER` rows (out at the sender on approval, in at the receiver on receipt)
  - let the receiving branch's manager (`Branch.managerId`) or ADMIN confirm receipt
  - show what moved on the detail page
  - add transfers to `SOURCE_PAGES` and End of Day's document links
- **Variance is Task 4.** The received quantity per line, and the difference valued at lot cost,
  come then.
- **Formatting.** `formatPeso` has no thousands separator (₱4840.00) anywhere in the app. That is a
  UI-polish item, not specific to transfers.
