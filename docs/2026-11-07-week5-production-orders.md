# 2026-11-07 — Production orders: create and edit drafts (Week 5, Task 1)

Week 5 Task 1, "Production Order form: finished good, batch weight, batches, production date".
`ProductionOrder` existed since Week 1 with no pages or API. A production manager (or admin) can
now plan a run of a finished good from its active BOM, save it as a draft numbered `PRD-000001`,
see it in a list and on its own page, and edit it while it is a draft. Submitting for approval is
Task 5; scaled ingredient requirements are Task 2.

Built in subtasks 1.1–1.4 (2026-11-07/08). Tracker: `docs/week5-task1-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Form: finished good (active BOM only), batch weight (defaults to the BOM's batch size, editable), number of batches (whole number 1–100), production date (today or later, Asia/Manila), branch (default Main Commissary, the oldest active branch), notes | The cap of 100 catches a typed 1000 for 10. |
| D2 | New columns `batchWeight` (Decimal) and `batchCount` (Int); `plannedQty` = weight × batches, computed in Decimal by the service and stored | Week 6 compares `actualQty` with `plannedQty`. |
| D3 | `ProductionStatus` replaced: `DRAFT → PENDING_APPROVAL → APPROVED / REJECTED → IN_PROGRESS → COMPLETED`, plus `CANCELLED`; default `DRAFT` (`PLANNED` dropped) | Safe only because the table had 0 rows and no code used the enum. |
| D4 | `PRD-000001` from the new sequence `prd_number_seq`, `nextval()` inside the creating transaction | Same as PR / PO / RR. |
| D5 | ADMIN + PRODUCTION_MANAGER create and edit. Any of them may edit a draft; `requestedById` is the creator and never changes | Planning is shared work. Task 5 adds a `submittedById`, which the self-approval check will compare against. |
| D6 | Drafts only: save and edit. Submit / approve is Task 5 | — |
| D7 | Pages `/production/orders` (status filter, paged), `/new`, `/[id]`, `/[id]/edit` | Same shape as receiving. |
| D8 | The form shows the BOM version and batch size; the detail page links to the BOM viewer scaled to the order's output. Ingredient requirements are Task 2 | — |
| D9 | **Every draft save re-pins `bomId` to the active version**, whether or not the finished good changed. The detail page flags a draft whose pinned version has been superseded | A draft must never quietly keep an outdated recipe; the pin becomes permanent at submit. |
| D10 | Refuse (400) when the BOM's batch unit differs from the finished good's unit | There is no unit conversion yet, so a mismatch would make `plannedQty` silently wrong once Week 6 adds it to stock. All three BOMs are kg/kg today. |
| — | New guard `/api/production-orders`: ADMIN + PRODUCTION_MANAGER | Only the `/production` pages were guarded; without it any signed-in user could POST. |
| — | Indexes `ProductionOrder(status)`, `(branchId)` | `database.md` listed them as "add with the feature". |

## What changed

- *1.1 Schema.* Migration `20261107073325_week5_production_orders`: enum replaced (Prisma's
  create-new-type / `ALTER COLUMN … USING` / drop-old sequence), `batchWeight` and `batchCount`
  added `NOT NULL` without a default (table verified empty), default `DRAFT`, the two indexes,
  and a hand-appended `CREATE SEQUENCE "prd_number_seq"`.
- *1.2 New order.* `ProductionOrderRepository.create()` (number + insert in one transaction);
  `BomRepository.findAllActiveForPlanning()` (active BOMs of active goods, for the picker);
  `ProductionOrderService.getForm()` and `create()`, with every rule in one `validateOrder()`
  that edit reuses; `POST /api/production-orders`; `ProductionOrderForm` (choosing a good fills
  its batch size and shows "BOM vN · one batch makes X kg"; live planned output; amber messages
  disable Save); `/production/orders/new`.
- *1.3 Read pages.* `findMany()` / `findById()` with one include (good, pinned BOM, branch,
  requester); `ProductionOrderService.list()` / `getById()` (looks up the active version only
  when the pin is superseded); the list page (status filter in the URL, unknown status ignored,
  50 per page, newest first) and the detail page (planned output as `N batches × W`, BOM link
  with `?qty=`, superseded banner); `not-found.tsx`; `StatusBadge` gains `IN_PROGRESS` and
  `COMPLETED`.
- *1.4 Edit a draft.* `ProductionOrderRepository.updateDraft()` — `updateMany` with
  `status: DRAFT` in the `WHERE`, false on 0 rows; `ProductionOrderService.update()` (403 / 404 /
  409 not a draft / same validation / re-pin / 409 changed meanwhile); `PATCH
  /api/production-orders/[id]`; the edit page (checks the role itself; keeps a since-deactivated
  branch selectable; says so when the good can no longer be planned); an Edit button on drafts.

## Files affected

- `prisma/schema.prisma`, `prisma/migrations/20261107073325_week5_production_orders/migration.sql` (new)
- `repositories/production-order.repository.ts` (new), `repositories/bom.repository.ts`
- `services/production-order.service.ts` (new)
- `app/api/production-orders/route.ts`, `app/api/production-orders/[id]/route.ts` (new)
- `app/(protected)/production/orders/page.tsx`, `new/page.tsx`, `[id]/page.tsx`, `[id]/edit/page.tsx`, `not-found.tsx` (all new)
- `components/production/ProductionOrderForm.tsx` (new), `components/procurement/StatusBadge.tsx`
- `middleware.ts`
- `docs/api.md`, `docs/architecture.md`, `docs/database.md`, `docs/overview.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

## Database changes

Migration `20261107073325_week5_production_orders` — see D3, D4 and 1.1. Forward-only; the enum
swap and the `NOT NULL` columns without defaults would fail (correctly) on a table with rows.
After applying: `npx prisma generate`, restart `npm run dev` and `npm run worker`.

## API changes

`POST /api/production-orders`, `PATCH /api/production-orders/[id]`, guarded to ADMIN +
PRODUCTION_MANAGER — see `docs/api.md#production-orders`.

## UI changes

The sidebar's existing "Production Orders" link now opens a list; new, detail and edit pages.

## Configuration / environment

None.

## How to verify

```bash
npx tsc --noEmit && npm run lint
```

Checked during the build (curl, throwaway rows removed and `prd_number_seq` reset afterwards):
production → 201 `PRD-000001`, 10.1 × 3 stored as exactly 30.3; past date, weight 0, 101 or 2.5
batches, unknown finished good → 400; procurement on the API and accounting on the pages →
`/unauthorized`. Edit: Bopis → Dinuguan re-pins to Dinuguan v1 with the requester unchanged; a
deliberately stale pin is re-pinned on save; a `PENDING_APPROVAL` order → 409 with no Edit
button, and `updateDraft()` called directly on it returns false and writes nothing. Superseded
banner checked by deactivating a BOM for a few seconds.

In the browser: as production@, Production Orders → New production order → Dinuguan, 10 × 2,
tomorrow → Save draft → the detail page → Edit.

## Risks / assumptions / follow-up

- **Task 5 needs a guard change.** Guards are AND-ed, so the `/production` baseline (ADMIN +
  PRODUCTION_MANAGER) keeps accounting off `/production/orders`. Approval will need `/production`
  widened and a narrower `/production/bom` guard. The edit page and Edit button already check
  the role themselves for that reason.
- Batch weight is in the BOM's batch unit and must equal the finished good's unit (D10) until
  there is unit conversion.
- The "superseded by vN" wording was not exercised against real data (it would mean creating a
  BOM version, which cannot be deleted); the "no active BOM now" branch was.
- No cancel or delete of a draft yet; a mistaken draft stays as a draft.
- The list sorts by creation, not production date; the schedule calendar (Task 7) is the date
  view.
