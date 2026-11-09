# 2026-11-09 — Finished goods expiry: shelf life and lot expiry (Week 6, Task 4) — Week 6 complete

Week 6 roadmap task "Batch number, production date, expiry date assigned to finished goods". The lot
number (= the order number) and the production date came with Task 2's sign-off. This adds the
expiry:
- Each finished good has a **shelf life** in hours.
- Each lot **expires** that long after its run was reported done, fixed when accounting approves.
- The Finished Goods page lists lots soonest to expire first and flags expired ones.

With this, Week 6 is complete.

Built in subtasks 4.1–4.4, each verified with curl and SQL and tested by the user in the browser.
Tracker: `docs/week6-task4-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | `FinishedGood.shelfLifeHours`: whole hours 1–720, nullable, set by admin in Master Data; the list shows "72 h · 3 days" | Cooked food is counted in hours, and Week 7 flags items 24/48 h before expiry. The 720 h (30-day) cap is a typo guard like the batch and yield caps. |
| D2 | `FinishedGoodLot.expiresAt` = the moment the kitchen reported the run done (`completedAt`) + the shelf life, stored on the lot at approval; indexed | Food ages from cooking, not from accounting's approval. Stored, like cost, so a later shelf-life change never moves a labelled lot. The index serves the soonest-first list and Week 7's expiring-soon query. |
| D3 | No shelf life → approval refused (409 naming the finished good); the preview warns first; rejecting still works | A lot without an expiry could never be flagged and cannot be given one afterwards. It is a one-time setting per finished good, the same pattern as a missing price. |
| D4 | No backfill; the user set the real shelf lives in Master Data during the test (Dinuguan 72 h, Lechon Paksiw 96 h, Bopis 72 h) | Business data, not invented. |
| D5 | Preview "expiring Nov 13, 6:01 PM (96 h · 4 days after it was reported done)"; Stock moved card "expires …"; Finished Goods: an Expires column, a red Expired badge and row once past, soonest expiry first (none last) | First to expire, first used. The 24/48 h warnings and the daily job are Week 7. |
| D6 | Roadmap: the task done, Week 6 done, Week 7 next | — |

## What changed

- *4.1 Schema.* `FinishedGood.shelfLifeHours`, `FinishedGoodLot.expiresAt` and
  `@@index([expiresAt])`; migration `20261109150000_finished_good_expiry`.
- *4.2 Master Data.*
  - A Shelf life column (amber "Not set" when empty) and a "Shelf life (hours)" field with a hint.
  - `POST` and `PATCH /api/finished-goods` accept `shelfLifeHours` (zod: integer 1–720 or null). On
    PATCH, an absent field leaves it unchanged and `null` clears it.
  - `MAX_SHELF_LIFE_HOURS` lives in `finished-good.service.ts` and is passed to the form. New
    `formatShelfLife()` in `lib/format.ts`.
- *4.3 Expiry at approval.* `lotExpiry()` in the service. `applyCompletionDecision()` refuses a
  missing shelf life before costing, then passes `expiresAt` to `receiveLot()`. The completion
  preview and the Stock moved card show the expiry. The Manila date-time formatter, which was copied
  in two files, is now `formatDateTime()` in `lib/dates.ts`, used by the timeline, Finished Goods
  and both cards.
- *4.4 Finished Goods.* `findLevels()` orders by `expiresAt` ascending, nulls last (it was newest
  production first). Each lot DTO carries `expiresAt` and `expired`, worked out against one clock
  per page. The page shows an Expires column, the Expired badge and red tint, and a new
  description.
- Found in the user's test of 4.2: "formatShelfLife is not a function" after saving. That browser
  tab had kept an older hot-reloaded copy of `lib/format.ts`. The served bundle was correct, and a
  hard refresh fixed it; no code change.

## Files affected

- `prisma/schema.prisma`, `prisma/migrations/20261109150000_finished_good_expiry/migration.sql` (new)
- `services/finished-good.service.ts`, `services/production-order.service.ts`, `services/inventory.service.ts`
- `repositories/finished-good.repository.ts`, `repositories/production-order.repository.ts`, `repositories/finished-good-stock.repository.ts`
- `app/api/finished-goods/route.ts`, `app/api/finished-goods/[id]/route.ts`
- `components/master/FinishedGoodsPanel.tsx`, `app/(protected)/admin/master/page.tsx`
- `components/production/CompletionReview.tsx`, `components/production/CompletionStock.tsx`, `components/production/StatusTimeline.tsx`
- `app/(protected)/inventory/finished-goods/page.tsx`
- `lib/format.ts`, `lib/dates.ts`
- `docs/api.md`, `docs/architecture.md`, `docs/database.md`, `docs/overview.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

## Database changes

Migration `20261109150000_finished_good_expiry`: two nullable columns and an index. After applying
it: `npx prisma generate`, restart `npm run dev` and `npm run worker`, and in VS Code "TypeScript:
Restart TS Server".

Data entered by the user (kept): shelf lives Dinuguan 72 h, Lechon Paksiw 96 h, Bopis 72 h.

## API changes

`POST` / `PATCH /api/finished-goods` accept `shelfLifeHours`. `POST /api/approvals` with
`ProductionCompletion` returns 409 when the finished good has no shelf life. See `docs/api.md`.

## UI changes

Shelf life in Master Data; expiry in the approval preview and the Stock moved card; Expires column,
Expired badge and soonest-first order on Finished Goods.

## Configuration / environment

None.

## How to verify

```bash
npx tsc --noEmit && npm run lint
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

Run on 2026-11-09 with curl, SQL and the rendered pages. The test orders PRD-000005 and PRD-000006
were deleted afterwards with everything they created: 16 notifications, 4 approvals, 10 log rows,
20 stock movements, 2 lots and 13 stock levels. Pork Belly was restored to 4 kg with its
`updatedAt`. Every finished-good row I changed for a test was put back exactly, including
`updatedAt`. All counts match the task-start snapshot.

- Master Data API: 72 saved; 0, 721, 1.5 and "72" → 400; absent kept the value; null cleared it;
  production → `/unauthorized`; create with 750 → 400. The tab shows "48 h · 2 days" / "Not set".
- A Dinuguan run reported Nov 9, 6:01 PM: the preview says it expires Nov 12, 6:01 PM. With the
  shelf life cleared: the red note, then 409 on approve, with no lot or stock written.
- After approval, `expiresAt − completedAt` = exactly 3 days, shown on the Stock moved card.
  Changing the shelf life to 48 h afterwards did not change the lot.
- Finished Goods with the stored expiries briefly changed: a later expiry sorts below, an expired
  lot goes to the top with the Expired badge and red row, and a lot with no expiry shows "—" and
  sorts last.

## Risks / assumptions / follow-up

- Expiry is a fixed shelf life per finished good. Storage conditions (chilled vs frozen) and
  per-branch rules are not modelled.
- Nothing yet prevents an expired lot from being used. The 24/48 h warnings, the daily job and
  write-offs of expired stock are Week 7.
- Lots made before this change would have no expiry; none exist.
