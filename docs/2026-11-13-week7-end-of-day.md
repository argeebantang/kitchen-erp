# 2026-11-13 — End-of-day reconciliation (Week 7, Task 4)

Week 7 roadmap task "End-of-day reconciliation: produced, distributed, converted, written-off" — the
last task of Week 7.

What happened to finished goods on one day, per branch:
- what was there in the morning
- what was produced
- what was converted in and out
- what was written off
- what was distributed
- what is left

All of it is read from the stock ledger the earlier tasks already write, so it cannot disagree with
the books. Production managers, accounting and admins also get a 21:00 summary. No schema change.

Built in subtasks 4.1–4.4, each verified with SQL, direct service calls and the rendered pages; the
user's browser steps are in the tracker, `docs/week7-task4-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| E1 | A daily summary per branch and finished good from the ledger: opening → + produced + converted in − converted out − written off − distributed (transfers, from Week 8) → closing; kg and value at cost; a check that opening + movements = closing | The roadmap's four flows, on the books already kept, so it cannot disagree with them. |
| E2 | A Manila calendar day (midnight to midnight); a movement counts on the day accounting approved it — when stock moved — not the day it was cooked | Using the approval day is what makes opening + movements = closing hold; the page says so. |
| E3 | Inventory → End of Day: date (today by default, ‹ › for previous / next day) and branch; summary table; the documents behind each figure (PRD / CNV / WO links). Every role that can see Finished Goods | One place to close the day. |
| E4 | Daily job `end-of-day-summary` at 21:00 Manila: one notification per production manager, accountant and admin with the day's figures and closing value; once per person per day; nothing on a day with no movement | Closes the loop with the 06:00 expiry summary; accounting sees the money side. |
| E5 | Not now: a physical end-of-day count (books vs count, approved as a stock adjustment) — with the stock-adjustment follow-up; sales are not recorded | Keeps the task to what the books can say. |
| Answers | Books-only summary now; closing at 21:00; summary to production managers, accounting and admins | The user accepted the recommendations. |

## What changed

- *4.1 Daily summary page.*
  - `FinishedGoodStockRepository.dayFlows(start, end, branch)`: one SQL statement over
    `FinishedGoodMovement`. Per finished good and branch it returns opening (before the day), each
    flow within the day, `other` (a movement that fits no flow) and closing (before the day's end).
    Each figure comes in quantity and value. A movement's value is its quantity × its lot's recorded
    cost per unit (the lot's first `IN`), so the pesos add up like the kilos.
  - `FinishedGoodStockRepository.levelTotals(branch)`: what the stock levels hold now.
  - `lib/dates.ts`: `businessDayRange(date)` (Manila midnight to midnight) and `addDays`.
  - New `services/end-of-day.service.ts`: `EndOfDayService.forDay` and `endOfDayDate` (a missing,
    malformed or future date is today).
    - `balanced` means opening + the named flows = closing.
    - `matchesStock` (today only) means closing = the stock levels.
  - New page `app/(protected)/inventory/end-of-day/page.tsx`, in the sidebar for every role.
    - ‹ previous / date / next ›, Today, and a branch filter (GET form, so a day can be linked).
    - A table with a "Value at cost" totals row.
    - A Check column (✓ / "Unrecognised N" / "Stock differs") and a green / red banner.
  - Fixed while testing: the first balance check included `other`, so it could never fail. It now
    leaves `other` out. Both failure cases were forced with temporary rows and seen flagged.
- *4.2 Documents and values.*
  - `DAY_FLOWS` in the repository is the one list deciding which movements make each flow
    (`type` + `referenceType`). `dayFlows` and the new `dayDocuments` both read it, so the documents
    under each flow always add up to its column.
  - `dayDocuments` groups movements per document, flow, good and branch, with the lots, quantity,
    value and the time the stock moved.
  - `WriteOffRepository.numbersByIds`. `SOURCE_PAGES` (the Stock Ledger's who-may-open-what map) is
    exported and gains `WriteOff`.
  - The page lists "Documents behind the figures" below the summary. Numbers link for ADMIN,
    PRODUCTION_MANAGER and ACCOUNTING; other roles see the number.
- *4.3 Evening summary.*
  - New job `END_OF_DAY_SUMMARY` in `lib/queue.ts`, in `DAILY_JOBS` at `0 21 * * *`, with a worker
    handler.
  - `NotificationService.notifyEndOfDay(date)`, built from `EndOfDayService.forDay` (no viewer, so
    no links):
    - type `END_OF_DAY`, reference `EndOfDaySummary` + the date
    - the title gives the movements, the closing value and any rows not reconciling
    - the body gives, for each good that moved, opening → closing and its flows, then the pesos by
      flow, then "As of 9:00 PM" (today only)
  - The bell opens End of Day on that date.

## Files affected

- `lib/dates.ts`, `lib/queue.ts`, `lib/navigation.ts`
- `repositories/finished-good-stock.repository.ts`, `repositories/write-off.repository.ts`
- `services/end-of-day.service.ts` (new), `services/inventory.service.ts`, `services/notification.service.ts`
- `app/(protected)/inventory/end-of-day/page.tsx` (new)
- `worker/index.ts`
- `docs/api.md`, `docs/architecture.md`, `docs/database.md`, `docs/overview.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

## Database changes

None. New notification type `END_OF_DAY` (reference `EndOfDaySummary`, the Manila date). The day
queries filter `FinishedGoodMovement` on `createdAt` with no index of its own. That is fine at the
current size; add `(createdAt)` if the ledger grows large.

## API changes

None. New page `GET /inventory/end-of-day?date=YYYY-MM-DD&branch=<id>`. The bell links
`EndOfDaySummary` to `/inventory/end-of-day?date=<the date>`.

## UI changes

- **Inventory → End of Day** (new, every role): the summary, the check and the documents.
- **Bell**: the 21:00 end-of-day summary for production managers, accounting and admins.

## Configuration / environment

None. The worker registers the new schedule at startup (`end-of-day-summary scheduled "0 21 * * *"
Asia/Manila`), so it needs a restart after pulling this.

## How to verify

```bash
npx tsc --noEmit && npm run lint
npm run job -- end-of-day-summary      # with npm run worker running (restarted)
```

Run on 2026-11-13. The test data was real flows through the app:
- two Lechon runs of 18 kg (one with its stock-in moved to Nov 12)
- a conversion CNV-000001 (10 kg Lechon → 16 kg Paksiw)
- a write-off WO-000001 (2 kg)

- **Summary.**
  - Today: Lechon 18 → +18 produced, −10 converted out, −2 written off → 24 kg (₱11,510.00);
    Paksiw +16 kg (₱5,552.92); total ₱17,062.92. All figures match an independent SQL calculation.
  - Nov 12: Lechon produced 18 kg, closing 18. Nov 11 is empty.
  - Future and malformed dates show today; the arrows keep the branch.
- **Checks.** A temporary unrecognised movement showed "Unrecognised 1" and an "Unrecognised" document
  row. A level changed by 1 kg showed "Stock differs". Both were restored exactly.
- **Documents.**
  - Four rows (PRD-000006, CNV-000001 out and in, WO-000001), each matching its column.
  - Accounting gets links (the write-off opens; viewer is sent to /unauthorized); viewer sees plain
    numbers. The Stock Ledger is unaffected.
- **Evening summary.** Called directly:
  - 3 notifications (admin, accounting, production); a second run wrote 0; a day with no movement
    sent nothing.
  - The bell links open the right day.
  - The user ran it through the worker with `npm run job`.
- **Cleanup.** Afterwards I deleted 2 production orders, 1 conversion, 1 write-off, 3 lots with their 3
  levels and 5 movements, 24 stock movements, 11 stock levels, 10 status changes, 6 approvals and 25
  notifications (including the user's 3 end-of-day ones). `prd_number_seq`, `cnv_number_seq` and
  `wo_number_seq` were reset. All counts match the task-start snapshot.

## Risks / assumptions / follow-up

- **Books only.** Closing is what the books say is left, not a count. Sales are not recorded, so
  sold Lechon still shows on hand. A physical count, with differences approved as stock adjustments,
  comes with the stock-adjustment follow-up.
- **Distributed** counts every `TRANSFER` movement. Week 8 transfers must write `TRANSFER` rows (out
  at the sender, in at the receiver) to appear there. Anything else shows as "Unrecognised".
- **Late runs.** The 21:00 run reports the day it runs on. If the worker is down at 21:00 and catches
  up after midnight, it reports the new day (usually nothing), and the missed day gets no summary.
  The page still has it.
- Movements approved after 21:00 are on the page but not in that day's notification.
- Finished goods only. Raw materials have the Stock Ledger and the 06:00 checks.
- The Week 11 "End-of-day branch snapshot report" (export) can build on `EndOfDayService`.
