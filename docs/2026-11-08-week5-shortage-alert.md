# 2026-11-08 — Production orders: shortage alert (Week 5, Task 4)

Week 5 Task 4, "Shortage alert: flag exactly which ingredients are insufficient". Task 3 marked
each requirement line Enough or Short; with 11–14 lines the shortages were scattered through the
table. A banner above the table now names every short ingredient and by how much, short rows are
tinted, and from the order page one click opens a purchase request pre-filled with the shortfall.

Built in subtasks 4.1–4.2. Tracker: `docs/week5-task4-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Banner above "Materials required", on the order page and in the form preview. Red: "Short on N of M ingredients at <branch>" plus one chip per short ingredient with its amount. Green: "All M ingredients are in stock" | "Flag exactly which" = named where they can't be missed. The amounts are the same `stock.short` figures as the table's Stock column; the banner gathers them. |
| D2 | Short rows tinted red; BOM (alphabetical) order kept | Re-sorting would make the order page and the BOM viewer list ingredients differently. |
| D3 | "Request missing materials" on the order page's red banner → `/procurement/requests/new?productionOrder=<id>`, pre-filled: one line per short material at the short quantity, needed-by = the production date, a note naming the order. Reviewed and saved as usual | Closes short → ordered. Purchase request drafts cannot be edited after saving (no PATCH), so the form is pre-filled rather than a request created. |
| D4 | Button and pre-fill for ADMIN + PRODUCTION_MANAGER, while the order is DRAFT, PENDING_APPROVAL or APPROVED (`SHORTFALL_REQUEST_STATUSES`) | A run in progress is too late to order for. Other roles get the ordinary empty form. |
| D5 | No notification to procurement in this task | Every draft save would be noise; Task 5 can notify when an order with shortages is approved. |
| D6 | No shortage column on the orders list | It would mean a stock check per row on every list load; Task 5's approvals inbox is where a count matters. |
| D7 | Built only from the per-line stock check of Task 3; no new query; nothing shown where stock is hidden | One source of truth. |

## What changed

- *4.1 Banner.* New `components/production/ShortageBanner.tsx` (no state, renders on the server
  and inside the form): red with one chip per short ingredient in a wrapping row, or green, or
  nothing when the lines carry no stock check. `MaterialRequirementsTable` tints short rows; its
  Enough / Short pills are `inline-block` so their padding can't overlap the line above. On the
  order page and above the form preview. Follow-up during review: the chips replaced
  `whitespace-nowrap` spans in running text, which ran into each other on narrow windows.
- *4.2 Request missing materials.* `ProductionOrderService.shortfallRequest(id)` →
  `ShortfallRequestDto` (or null: unknown order, wrong status, nothing short); quantities written
  with `toFixed()` so a tiny value never becomes `1e-7`, which the purchase request pattern
  rejects. `ShortageBanner` takes `requestHref`; the order page passes it for the D4 roles and
  statuses. `/procurement/requests/new` reads `?productionOrder=` (D4 roles only), shows an amber
  note linking back to the order, and keeps only lines whose material the picker offers.
  `PurchaseRequestForm` accepts optional `initial` values (needed-by, notes, lines); without them
  it behaves as before.

## Files affected

- `components/production/ShortageBanner.tsx` (new), `components/production/MaterialRequirementsTable.tsx`, `components/production/ProductionOrderForm.tsx`
- `services/production-order.service.ts`
- `app/(protected)/production/orders/[id]/page.tsx`
- `app/(protected)/procurement/requests/new/page.tsx`, `components/procurement/PurchaseRequestForm.tsx`
- `docs/architecture.md`, `docs/overview.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

## Database changes

None.

## API changes

None. The pre-fill is a page query parameter; saving uses the existing
`POST /api/purchase-requests`.

## UI changes

Shortage banner and tinted rows on the order page and the form preview; "Request missing
materials" button; pre-fill note on the new purchase request page.

## Configuration / environment

None.

## How to verify

```bash
npx tsc --noEmit && npm run lint
```

Checked during the build: PRD-000001 (Bopis) → "Short on 14 of 14" with every amount; a
throwaway Dinuguan 10 × 1 → "Short on 10 of 11" without Pork Belly (exactly enough, untinted);
completed → no banner or tint. The green and hidden states were rendered directly with sample
lines. Pre-fill for PRD-000001: needed-by = production date, the note, 14 lines at the short
quantities; procurement and an unknown id → empty form; button and pre-fill present for
`PENDING_APPROVAL` / `APPROVED`, absent for `IN_PROGRESS`. The pre-filled values posted to
`POST /api/purchase-requests` were accepted (a DRAFT with all 14 lines exact, no approval,
notification or purchase order); that request was deleted and `pr_number_seq` reset afterwards.

## Risks / assumptions / follow-up

- Needed-by is the production date even when that date has passed (an old draft); the requester
  can change it. Could default to today in that case if wanted.
- Short quantities are exact (e.g. 0.035 kg); purchasing rounds up by hand. Pack sizes / minimum
  order quantities are not modelled.
- Requesting twice creates two purchase requests; there is no link from a request back to the
  production order beyond its note.
- The green banner cannot occur with today's stock (nothing has every ingredient on hand).
