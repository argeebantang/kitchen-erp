# 2026-11-12 — Conversion orders: unsold Lechon → Lechon Paksiw (Week 7, Task 1)

Week 7 roadmap tasks "Conversion order: unsold lechon → lechon paksiw with conversion BOM", "COSTING:
record conversion cost from added ingredients" and "Conversion approval by accounting".

Lydia's Lechon roasts whole pigs; what does not sell is made into Lechon Paksiw the next day. This
task adds:

- **Lechon** as a finished good, roasted through ordinary production orders.
- **Conversion recipes**: a second kind of BOM that makes one finished good from another, plus added
  ingredients.
- **Conversion orders**: production records a conversion already done (what it used, what it made),
  and accounting approves it. Approval moves the stock and records the cost.

Built in subtasks 1.0–1.6, each verified with curl, SQL and the rendered pages, then tested by the user
in the browser. Tracker: `docs/week7-task1-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Lechon is a **finished good** (FG-LECHON, kg, ₱750/kg, 48 h), roasted through production orders. Its master data and BOM (20 kg batch from 32 kg Whole Pig) were entered through the app as admin | It is Lydia's main dish and has its own lots, expiry and cost, which a conversion takes. |
| D2 | `BOM.kind` (`PRODUCTION` \| `CONVERSION`) plus `sourceFinishedGoodId` + `sourceQuantity` per batch. One active version per finished good **per kind**, numbered per kind. Production planning sees `PRODUCTION` only. Paksiw's Conversion v1 = 6 kg Lechon + the added ingredients of its current BOM, minus RM-LECHON, per 10 kg | Reuses versioning, scaling and costing. The source is not a `BOMItem` because it comes out of finished-goods lots, not material stock. |
| D3 | Paksiw keeps its production recipe (with bought RM-LECHON); conversion is a second way to make it | Nothing that works today breaks. |
| D4 | A conversion order **records a conversion already done**: recipe, branch, source used, output made, notes → submit. No draft. Added ingredients = the conversion BOM × used ÷ source per batch. New `ConversionOrder` (CNV-000001, `cnv_number_seq`) replaces the empty `Conversion` stub | Leftovers are converted at once; the kitchen records what it used and made. Confirmed with the user after they asked whether the order should come before the cooking. |
| D5 | Submit needs enough **unexpired** source lots at the branch, less what other pending conversions there claim. Rechecked at approval. Added ingredients may go negative | You cannot convert what is not on hand. Pending claims stop two conversions counting the same kilo. |
| D6 | Accounting decides via `POST /api/approvals` (`referenceType: 'ConversionOrder'`); never whoever recorded it, ADMIN included; a reason to reject; `REJECTED` is final, and production records it again. Approve in **one transaction**: source lots out soonest expiry first (expired skipped), added ingredients out, output lot in | Stock moves only on sign-off, as with receiving and production. Expired food is a write-off, not an ingredient. |
| D7 | Cost recorded at approval: conversion cost = added ingredients × reference price on the conversion date; source cost = Σ kg taken × each lot's recorded cost per kg; cost per kg = (source + conversion) ÷ output. `unitCost` on every movement | Carries the leftover's real cost into the new dish. Stored for the same reason production cost is: prices can be back-dated. |
| D8 | Output lot numbered after the order (`FinishedGoodLot.conversionOrderId`), produced on the conversion date (Manila), expiring the output's shelf life after the conversion was recorded; refused without a shelf life | Same lot model as production. |
| D9 | Production → Conversions (list, record, detail; ADMIN + PRODUCTION_MANAGER record, ACCOUNTING reads and decides). Inbox section, CNV links on Finished Goods and the Stock Ledger, notifications both ways | Same patterns as production orders. |
| D10 | **No BOM editor** — none exists (BOMs come from the seed or `POST /api/boms`). The API accepts conversion recipes; the BOM pages show them read-only; Paksiw's was entered through the API as admin | Found at the start of 1.1. Keeps the task to conversions; nobody can edit any recipe in the app today either. |
| D11 | Output made ≤ 2 × what the recipe expects (typo guard, as for a production yield). Added-ingredient quantities are multiplied before dividing (1.5 × 25 ÷ 6 = 6.25 exactly), stored unrounded, shown to the gram. No shelf life → warned in the preview, refused at approval | Same guards as production. A repeating figure must not carry a rounding tail onto the ledger. |

Why approval when the conversion has already happened (asked by the user): approval does not permit
the cooking, it checks the **record** before it changes stock and cost. Examples: 40 kg made from
20 kg is 120% of the recipe (33.3 kg) and might be a typo for 34, or the Lechon used might have
expired. There is no stock adjustment or reversal yet, so a wrong figure posted directly could not
be corrected. Rejected means "the record is wrong — record it again", not "it did not happen". The
roadmap also lists accounting approval as a Week 7 task.

## What changed

- *1.0 Master data* (data only, through the API as admin). Materials RM-PIG-WHOLE "Whole Pig
  (Dressed)" ₱260/kg and RM-LEMONGRASS "Lemongrass (Tanglad)" ₱80/kg (from 2026-11-01). Finished good
  FG-LECHON. Lechon BOM v1.
- *1.1 Schema.* Migration `20261112090000_conversion_orders`, see Database changes.
- *1.2 Conversion BOM.*
  - `BomRepository`: `findActiveByFinishedGood(id, kind)` (kind required, so every caller says
    which); `createVersion` supersedes and numbers per kind; `findAllActiveForPlanning` →
    `PRODUCTION` only; new `findAllActiveConversions`.
  - `BomService.createVersion`: conversion rules in `checkSource`. The DTOs gain `kind` and `source`.
  - `POST /api/boms` and `GET /api/boms` take the new fields.
  - BOM pages: a violet Conversion badge, "from 6 kg Lechon", the source as the first (scaled) line,
    "Estimated added-ingredient cost", version history per kind.
  - The production-order service passes `BomKind.PRODUCTION` to all three planning look-ups.
  - Data: Lechon Paksiw Conversion v1 entered through the API (₱454.25 of added ingredients per 10 kg).
- *1.3 Record a conversion.*
  - New `ConversionOrderRepository`, `ConversionOrderService` and routes `POST
    /api/conversion-orders` and `GET /api/conversion-orders/preview`.
  - Pages `/production/conversions` (list, `new`, `[id]`, not-found) and a sidebar entry.
  - Components `ConversionOrderForm` (live, debounced, abortable preview) and `ConversionEffect`.
  - `FinishedGoodStockRepository.lotsOnHand`. Middleware guards.
  - New `formatQuantity()` in `lib/format.ts`.
  - Fixed while testing: scaling through a rounded factor gave Liver Sauce 6.2500000000000000001 kg.
    Lines are now multiplied before dividing.
- *1.4 Approval.*
  - `FinishedGoodStockRepository`: `planFefoTakes` (pure; preview and approval share it), `lockLots`,
    and `takeFromLot` (a lot never goes below zero).
  - `receiveLot` takes `conversionOrderId`.
  - `ConversionOrderRepository.decide` (one transaction; a short source rolls back with
    `ConversionConflict`) and `findPending`.
  - Service: `applyDecision` (shelf life and price refusals before writing), `listPending`, the cost
    preview (`ConversionCostDto`), and `conversionStock` / `recordedCost` for approved orders.
  - `/api/approvals` dispatches `ConversionOrder`, and `ApprovalActions` accepts it.
  - The detail page gets `DecisionHistory`, `ApprovalActions` and a new `ConversionStock` card. New
    Conversions section in the inbox.
- *1.5 Notifications and links.*
  - Queue jobs `conversion-order-submitted` and `conversion-order-decided`, with worker handlers.
  - `NotificationService.notifyConversionSubmitted` / `notifyConversionDecided`, and bell link
    `ConversionOrder`.
  - The Stock Ledger resolves `ConversionOrder` sources to CNV numbers
    (`ConversionOrderRepository.numbersByIds`, `SOURCE_PAGES.ConversionOrder`).
  - Finished Goods links CNV lots; its wording covers conversions.

## Files affected

- `prisma/schema.prisma`, `prisma/migrations/20261112090000_conversion_orders/migration.sql` (new)
- `repositories/bom.repository.ts`, `repositories/finished-good-stock.repository.ts`, `repositories/conversion-order.repository.ts` (new)
- `services/bom.service.ts`, `services/production-order.service.ts`, `services/conversion-order.service.ts` (new), `services/inventory.service.ts`, `services/notification.service.ts`
- `app/api/boms/route.ts`, `app/api/approvals/route.ts`, `app/api/conversion-orders/route.ts` (new), `app/api/conversion-orders/preview/route.ts` (new)
- `app/(protected)/production/bom/page.tsx`, `app/(protected)/production/bom/[id]/page.tsx`
- `app/(protected)/production/conversions/page.tsx`, `new/page.tsx`, `[id]/page.tsx`, `not-found.tsx` (all new)
- `app/(protected)/procurement/approvals/page.tsx`, `app/(protected)/inventory/finished-goods/page.tsx`
- `components/production/ConversionOrderForm.tsx`, `ConversionEffect.tsx`, `ConversionStock.tsx` (new); `components/procurement/ApprovalActions.tsx`
- `middleware.ts`, `lib/navigation.ts`, `lib/format.ts`, `lib/queue.ts`, `worker/index.ts`
- `docs/api.md`, `docs/architecture.md`, `docs/database.md`, `docs/overview.md`, `docs/coding-conventions.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

## Database changes

Migration `20261112090000_conversion_orders`:

- **Enums.** New `BomKind` and `ConversionStatus`.
- **`BOM`.** Gains `kind` (`NOT NULL DEFAULT 'PRODUCTION'`, so the 4 existing recipes became
  production), plus `sourceFinishedGoodId` and `sourceQuantity`. The unique key becomes
  `(finishedGoodId, kind, version)` and the index `(finishedGoodId, kind, isActive)`.
- **`ConversionOrder`.** New table, with `(status)` and `(branchId)` indexes.
- **`Conversion`.** The old stub had 0 rows and is dropped, with its two `FinishedGood` relations. A
  guard in the migration raises an error instead if it has rows.
- **`FinishedGoodLot`.** Gains `conversionOrderId` (unique, nullable).
- **Hand-added.** `BOM_kind_source_check`, `FinishedGoodLot_one_source_check` and `cnv_number_seq`.

The model count stays 28. After applying it: `npx prisma generate`, restart `npm run dev` and `npm run
worker`, and in VS Code run "TypeScript: Restart TS Server".

Real data kept: the 1.0 master data (2 materials with a price each, FG-LECHON, Lechon BOM v1) and
Lechon Paksiw Conversion v1 (BOM 5, BOMItem 50).

## API changes

- `POST` / `GET /api/boms`: `kind`, `sourceFinishedGoodId`, `sourceQuantity`. `GET /api/boms/[id]`:
  `kind`, `source`.
- New `POST /api/conversion-orders` and `GET /api/conversion-orders/preview`.
- `POST /api/approvals` accepts `referenceType: 'ConversionOrder'`.

See `docs/api.md`.

## UI changes

- **Production → Conversions** (sidebar): a list with a status filter, the "Record Conversion" form
  with its live preview, and the detail page. The detail page shows the preview, Approve / Reject,
  the decision history and a Stock moved card with the recorded cost.
- **Approvals inbox**: a Conversions section.
- **BOM pages**: the Conversion badge and the source line.
- **Finished Goods**: CNV lot links and new wording.
- **Stock Ledger**: CNV source links.
- **Bell**: three new notification kinds.

## Configuration / environment

None. The worker must run for the notifications; it reloads code by itself.

## How to verify

```bash
npx tsc --noEmit && npm run lint
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

Run on 2026-11-12 with curl as production@ / accounting@ / admin@ / viewer@, SQL and the rendered
pages. Test data: three real Lechon runs through the full production flow (PRD-000005 to 000007, one
lot made to look expired) and the conversions built on them.

- **Schema.** CHECK constraints refuse a conversion BOM without a source (or with quantity 0), a
  production BOM with one, and a lot with no source document. Tested in a rolled-back transaction.
- **Conversion BOM.** 10 invalid requests refused (production with a source, conversion without one,
  into itself, quantity 0 / −1, batch in L, unknown source, bad kind, viewer). The added cost of
  ₱454.25 matches SQL. Planning still uses Paksiw production v1 with RM-LECHON. A throwaway Conversion
  v2 superseded only Conversion v1 (then removed).
- **Submit.**
  - Preview of 25 kg: takes 19 kg + 6 kg from the two unexpired lots and skips the expired one;
    expects 41.667 kg.
  - Refused: accounting / viewer, 0 used, 0 made, 21 kg from 6 kg, 40 kg (37.5 available), a
    production BOM, a bad branch, an empty body, 15 kg after 25 kg was claimed.
  - No stock moved.
- **Approval.**
  - Refused: production (→ `/unauthorized`), admin's own (403), no or blank reason (400), unknown id
    (404).
  - No shelf life / no price: 409 with nothing written; both rows were restored exactly.
  - Two simultaneous approvals: one 200, one 409.
  - All lots made to look expired: 409 "Only 0 kg of the 7 kg Lechon…", nothing written; it approved
    once they were valid again.
  - SQL check of a 10 kg → 16 kg approval: source ₱4,543.42, ingredients ₱757.08 (Liver Sauce
    exactly 2.5), ₱331.28/kg on the lot's IN row, expiry exactly 4 days later, both ledgers
    reconciled.
  - The user's own CNV-000001 took from two lots (19 + 1 kg) and recorded ₱10,613.29 for 40 kg
    (₱265.33/kg).
  - Rejection is final; its reason is shown.
- **Notifications** (real worker):
  - recorded by production → accounting + admin; recorded by admin → accounting only
  - approved → the recorder, with the lot and its cost
  - rejected → the recorder, with the reason
  - bell links open the conversion
- **Links.** CNV links on the Stock Ledger and Finished Goods for production and accounting; plain
  numbers for viewer.
- **Cleanup.** Afterwards I deleted every test row: 3 production orders, 2 conversions, 27
  notifications, 8 approvals, 15 status changes, 5 lots with their levels and 8 movements, 40 stock
  movements and 11 stock levels. `prd_number_seq` is back to 4 and `cnv_number_seq` is unused. All
  counts match the task-start snapshot, with Pork Belly at 4 kg and its original `updatedAt`. Earlier
  cleanups in 1.3–1.5 restored every level row exactly.

## Risks / assumptions / follow-up

- No BOM editor (D10): recipes of either kind are entered through `POST /api/boms`.
- A rejected conversion must be typed in again; a "Record again" button pre-filling the form from it
  was discussed and not built.
- No stock adjustment or approval reversal, so an approved conversion with a wrong figure cannot be
  corrected yet.
- Source claims by pending conversions are checked at submit only. Approval takes whatever is
  unexpired then, first approved first served, and refuses if short.
- The output's expiry counts from when the conversion was recorded, not when it was cooked: the
  record is made right after cooking (D4).
- The preview's cost can differ from what approval records if lots are used or expire in between.
  The recorded figure is the one that counts.
- The inbox runs a few stock and price queries per pending conversion, like production completions.
- Notification jobs are not idempotent (as before). There is no finished-goods ledger page.
- Lots expiring 24 / 48 h ahead and write-offs of expired lots are the next Week 7 tasks. Only
  conversions skip expired lots so far.
