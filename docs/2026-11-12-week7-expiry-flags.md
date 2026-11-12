# 2026-11-12 — Expiry flags: lots expiring within 24 / 48 hours (Week 7, Task 3)

Week 7 roadmap task "Expiry tracking: flag items 24/48 hours before expiry".

Every finished-goods lot already had a stored expiry (Week 6 Task 4), and Finished Goods marked
expired lots. This task flags lots **before** they expire, where the kitchen decides what to sell,
convert or write off:
- **Expired**
- **within 24 h**: use or convert today
- **within 48 h**: plan for it

Production managers and admins also get a morning summary. No schema change.

Built in subtasks 3.1–3.4, each verified with curl, SQL, inline checks and the rendered pages; the
user's browser steps are in the tracker, `docs/week7-task3-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| X1 | Three flags worked out on each read against one clock — Expired, within 24 h, within 48 h (24–48 h left) — nothing stored. Fixed 24 / 48 h thresholds for every product, as in the roadmap | The expiry is stored; a flag is only how long is left, so it can never go stale. |
| X2 | Finished Goods: a badge ("Expires in 9 h") in the Expires column, tinted rows, and count chips ("1 expired · 1 within 24 h · 1 within 48 h") that filter the lots (`?expiry=expired\|24h\|48h`, keeping the branch) | Where the morning decision is made; Write off is on each row. |
| X3 | Daily job `expiry-check` at 06:00 Manila: one notification per production manager and admin listing the flagged lots, most urgent first, with time left and the value at cost; once per person per day; nothing when nothing is flagged | A to-do before service, for the people who convert or write off. |
| X4 | The same badge on the conversion form's source lots and on the write-off form and page | The urgency shows where you act on it. |
| X5 | Not now: automatic write-offs (a person always decides), per-branch views (Week 8), the dashboard card (the page is a placeholder), end-of-day reconciliation (Task 4) | Keeps the task to the roadmap item. |
| Lechon | Fixed thresholds kept: Lechon (48 h shelf life) is "within 48 h" from the moment it is roasted and "within 24 h" from the next day | Asked of the user, who accepted the recommendation: it must be sold within two days. |

## What changed

- *3.1 Finished Goods.*
  - In `lib/dates.ts`: `expiryFlag(expiresAt, now)` (status decided to the millisecond, minutes left
    for display), `EXPIRY_URGENT_HOURS` (24), `EXPIRY_SOON_HOURS` (48) and `formatTimeLeft`.
  - New `ExpiryBadge` and `expiryRowClass` (`components/inventory/ExpiryBadge.tsx`). No hooks, so
    they render on server pages and inside client forms alike.
  - `InventoryService.finishedGoodStock` adds `expiry` per lot, `expiryCounts`, and an `expiry`
    filter (`EXPIRY_FILTERS`).
  - The page shows the chips, badges and tints. While a filter is on, a note says the totals still
    count every lot.
  - Fixed while testing: the first version decided "expired" on whole minutes, so a lot with under a
    minute left read "Expired" while the existing `expired` check still said no. Both now use the
    exact time.
- *3.2 Elsewhere.* `SourceLotDto` (conversion preview and page) and the write-off lot DTOs carry
  `expiry`. `ConversionEffect`, `WriteOffForm` and the write-off page render the badge. Expired
  source lots keep "Expired — not used".
- *3.3 Morning summary.*
  - New job `EXPIRY_CHECK` in `lib/queue.ts`, added to `DAILY_JOBS`, with a worker handler.
  - `FinishedGoodStockRepository.findExpiringBy(until)`, on the `expiresAt` index.
  - `NotificationService.notifyExpiringLots(date)`: type `EXPIRY_ALERT`, reference `ExpiryCheck` +
    the date. The bell links to Finished Goods.
  - Found while testing: the running worker reloaded on the first file edit but not on the later
    service edit (or a touch of its entry file), so on-demand runs failed with "notifyExpiringLots is
    not a function". The fix is a worker restart. Nothing in the code needed changing. After adding a
    job, restart `npm run worker` if its log shows the old code.

## Files affected

- `lib/dates.ts`, `lib/queue.ts`
- `components/inventory/ExpiryBadge.tsx` (new), `components/inventory/WriteOffForm.tsx`, `components/production/ConversionEffect.tsx`
- `services/inventory.service.ts`, `services/conversion-order.service.ts`, `services/write-off.service.ts`, `services/notification.service.ts`
- `repositories/finished-good-stock.repository.ts`
- `app/(protected)/inventory/finished-goods/page.tsx`, `app/(protected)/inventory/write-offs/[id]/page.tsx`
- `worker/index.ts`
- `docs/api.md`, `docs/architecture.md`, `docs/database.md`, `docs/overview.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

## Database changes

None. New notification type `EXPIRY_ALERT` (reference `ExpiryCheck`, the Manila date). The existing
`FinishedGoodLot(expiresAt)` index now serves the morning query.

## API changes

None. `GET /inventory/finished-goods` accepts `?expiry=`. The bell links `ExpiryCheck` to Finished
Goods.

## UI changes

- **Finished Goods**: expiry badges, tinted rows, and filter chips.
- **Conversion preview and page, write-off form and page**: the same badges.
- **Bell**: the 06:00 expiry summary.

## Configuration / environment

None. The worker registers the new schedule at startup (`expiry-check scheduled "0 6 * * *"
Asia/Manila`).

## How to verify

```bash
npx tsc --noEmit && npm run lint
npm run job -- expiry-check      # with npm run worker running
```

Run on 2026-11-12. Test data: four real Lechon runs through the full production flow, with expiries
set to cover each case — expired, +10 h, +30 h and +60 h.

- **`expiryFlag`.** 17 boundary checks: −1 ms, 0, 1 ms, 30 s, exactly 24 h, 24 h + 1 ms, 48 h,
  48 h + 1 ms, no expiry. `formatTimeLeft`: 6 checks.
- **Finished Goods.**
  - Chips read "1 expired · 1 within 24 h · 1 within 48 h".
  - Badges read Expired / Expires in 9 h / Expires in 29 h / none, with red / orange / amber / plain
    rows.
  - Each filter shows its one lot; chip links keep the branch; the active chip clears; the filter
    survives a branch change; an unknown value shows every lot.
- **Elsewhere.** The conversion preview data and page show the flags, with 18 kg taken from the
  9 h lot first. The write-off form shows the badge for each lot, and so does the write-off page.
- **Morning summary.**
  - The schedule is registered in Redis: `0 6 * * *`, Asia/Manila, next Nov 13, 06:00.
  - Called directly: 3 lots flagged, 2 notifications (production, admin) with the lots, time left
    and "Worth ₱25897.50 at cost" (matches SQL); a second run that day wrote 0; with no lot due
    within 48 h, nothing; accounting got nothing.
  - Through the worker it needs a fresh `npm run worker` (see above).
- **Cleanup.** Afterwards I deleted 4 production orders, 4 lots with their levels and movements, 32
  stock movements, 8 stock levels, 20 status changes, 8 approvals and 34 notifications (including the
  two expiry alerts from the user's test). `prd_number_seq` is back to 4. All counts match the
  task-start snapshot.

## Risks / assumptions / follow-up

- Thresholds are fixed for every product. Per-product warnings (say, relative to shelf life) would
  need a setting on `FinishedGood`.
- The summary runs once at 06:00. A lot that crosses into "within 24 h" during the day shows on
  Finished Goods at once, but no extra notification is sent.
- The dashboard still has no expiry card; it is a placeholder page.
- Nothing stops an expired lot being sold. Conversions skip expired lots; write-offs are how expired
  stock leaves.
- End-of-day reconciliation is the last Week 7 task.
