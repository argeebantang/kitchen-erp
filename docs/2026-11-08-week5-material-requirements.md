# 2026-11-08 — Production orders: material requirements from the BOM (Week 5, Task 2)

Week 5 Task 2, "Auto-calculate required raw materials from BOM". A production order now lists
every ingredient its run needs — per batch and in total — on the order page, and the new / edit
forms show the same list live while you type. The calculation is `scaleBomQuantities`, written
in Week 2 for exactly this. Task 3 (stock sufficiency) and Task 4 (shortage alert) add
"available" and "short" to the same list.

Built in subtasks 2.1–2.2. Tracker: `docs/week5-task2-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Derive, don't store.** Requirements = the pinned BOM scaled to the order, recomputed on read; no new table | The pinned version is immutable and the order's quantities are stored, so a copy could only drift. What a run actually consumed is a separate Week 6 record. |
| D2 | Columns: material (code), per batch, total. Per batch = BOM quantity scaled to `batchWeight`; total = scaled to `plannedQty` | The kitchen cooks batch by batch; purchasing and the stock check need the total. Both are scaled straight from the BOM rather than total = per batch × count, so the total never carries a rounded intermediate. |
| D3 | On the order page and as a live preview on the new and edit forms | See what a run needs before saving it. |
| D4 | Order page: the **pinned** version. Form preview: the **active** version | Each shows what is (or would be) stored; the superseded banner already explains the switch. |
| D5 | New `GET /api/production-orders/requirements?finishedGoodId=&batchWeight=&batchCount=` | Task 3 extends it with `&branchId` for stock. Reusing `GET /api/boms/[id]?targetQuantity` would have been replaced then. |
| D6 | One service function, `materialRequirements()`, behind both | The form and the order page cannot disagree. |
| D7 | No cost shown | The "BOM vN" link already shows today's estimated cost; costing at the production date's prices is Week 6. |
| D8 | Full Decimal values, trailing zeros trimmed for display | Same as the BOM viewer. |

## What changed

- *2.1 Order page.* `materialRequirements(bom, batchWeight, plannedQty)` in
  `ProductionOrderService` → `MaterialRequirementDto[]` (`perBatch`, `total`, as strings);
  `getById` also loads the pinned BOM with its lines and returns `requirements`. New
  `MaterialRequirementsTable` (no state, no `'use client'`: it renders on the server for the
  order page and inside the form). "Materials required" section on `/production/orders/[id]`.
- *2.2 Form preview.* `ProductionOrderService.previewRequirements()` (active BOM, weight > 0);
  `GET /api/production-orders/requirements` (zod on the query, count coerced); in
  `ProductionOrderForm`, a "Materials required" section that fetches 300 ms after typing
  pauses, aborts a superseded request, keeps the previous table dimmed while loading, and shows
  a prompt until the inputs are valid. Loading is derived (the stored answer belongs to an
  older query) rather than set inside the effect.
- *Also:* the list page's "New Production Order" button now uses the same markup as "New
  Request" on Purchase Requests; the new-order heading is title-cased to match.

## Files affected

- `services/production-order.service.ts`
- `components/production/MaterialRequirementsTable.tsx` (new), `components/production/ProductionOrderForm.tsx`
- `app/api/production-orders/requirements/route.ts` (new)
- `app/(protected)/production/orders/[id]/page.tsx`, `app/(protected)/production/orders/page.tsx`, `app/(protected)/production/orders/new/page.tsx`
- `docs/api.md`, `docs/architecture.md`, `docs/database.md`, `docs/overview.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

## Database changes

None.

## API changes

`GET /api/production-orders/requirements` — read-only, same guard as the rest of
`/api/production-orders` (ADMIN + PRODUCTION_MANAGER). See `docs/api.md#production-orders`.

## UI changes

"Materials required" table on the order page and under the new / edit forms; restyled "New
Production Order" button.

## Configuration / environment

None.

## How to verify

```bash
npx tsc --noEmit && npm run lint
```

Checked during the build: the order page's lines for Bopis 8 × 1 and a throwaway Dinuguan
10.1 × 3 (deleted afterwards, `prd_number_seq` reset) matched an independent SQL computation
line for line (e.g. Pork Belly 4.04 / 12.12 kg, Pork Blood 2.525 / 7.575 L); the preview
endpoint returns the same figures; weight 0 or `abc`, 0 / 101 / 2.5 batches and missing
parameters → 400, unknown finished good → 404, procurement → `/unauthorized`.

In the browser: New Production Order → Dinuguan → the table appears; change the weight to 10.1
and batches to 3 and it follows; save and compare with the order page.

## Risks / assumptions / follow-up

- Units are the materials' own; there is still no unit conversion (BOM lines must match the
  material's unit, and the batch unit the finished good's).
- The preview uses the active BOM. On a draft whose pin was superseded, the form shows the new
  version's lines and the order page the old one's until it is saved — intended (D4), and the
  page's banner says so.
- Each keystroke pause costs one small request (one BOM read); fine at this scale.
