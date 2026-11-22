# 2026-11-23 — Reorder Recommender, and the stock map shows kitchens only (Week 10, Task 4)

Week 10 roadmap task "FEATURE 4 — Reorder Recommender: when stock drops below reorder point, instead of just alerting,
Claude analyzes average daily consumption + supplier lead time + upcoming production orders and recommends exact order
quantity and deadline. Surfaces inline when a 🟡/🔴 location is clicked on the Week 4 stock map, with a 'Create
Purchase Order' button that applies the recommendation directly."

It also carries the fix the owner assigned to this task in Task 1: **the stock map, Branch Inventory and the daily
low-stock summary stop showing raw materials at the outlets** (57 "Out of stock" tiles that buried the kitchens' real
alerts).

It builds on Task 3's lead times (`SupplierService.leadTimes`, `docs/2026-11-23-week10-supplier-performance.md`), Task 2's
insight pieces (`AiInsightPanel`, `POST /api/ai/insights`) and Week 5's purchase request pre-fill.

What it gives:
- **Stock Levels:** kitchens only, with a kitchen picker. The reorder alerts table gains a **Recommended order** column
  ("16 kg by today · 1 day late even today").
- **A 🔴/🟡 tile's popup** (Stock Levels and a kitchen's Branch Inventory page):
  - The order and its deadline: "Order 16 kg by Nov 23 (today)", when it is expected to run short, and a red warning
    when even an order placed today arrives after that.
  - The working, line by line: daily use (last 30 days), supplier and lead time with its source, expected use over
    lead time + 7 days' cover, + safety stock (the reorder point), − on hand, − already on order for this kitchen,
    = the order, rounded up.
  - What drives it: the scheduled runs that use the material (overdue ones marked), requests and orders already on
    their way, open ones naming no kitchen (shown, not counted), and the supplier's flag from last month's supplier
    review.
  - **Create purchase request →**: opens the purchase request form pre-filled with the quantity, the needed-by date
    and a note naming the kitchen. Saving it makes a DRAFT that goes through approval as usual.
  - **Why this order** (AI badge): on **Explain**, Claude puts the figures into 3–5 plain sentences. Regenerate is
    available, and the panel says when the figures have changed since the explanation was written.
- **Outlets:** Branch Inventory shows "Raw materials: None held". It has no raw-material section and no Stock Levels
  or Stock Ledger links for an outlet.

Built in subtasks 4.1–4.4. Steps are in `docs/week10-task4-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| R1 | **The code works out every figure** (P1). **Daily use** is what left the kitchen's stock (OUT and WASTE movements) in the last 30 full Manila days ÷ 30, to 3 decimals. The **horizon** is lead time + **7 days' cover** (owner, 2026-11-21). **Expected use** is summed day by day: each day takes the larger of the daily use and that day's scheduled runs; overdue runs count on today. **Order** = expected use + reorder point − on hand − on order for this kitchen, rounded up to a whole unit (minimum 1), or none if that is 0 or less. **Runs short** is the first day the expected use passes what is on hand. **Order by** = runs short − lead time; when that has passed, it is today, with how many days late. **Needed by** (for the purchase request) is the day it runs short | Day by day, a one-off big run, such as a 12-pig catering order, adds to the ordinary days. A plain "average × days vs. schedule" lost it in the average: tested, it gave the same 11 kg with or without the catering run. The reorder point is the safety stock the owner sets, so it stays on top |
| R2 | **Scheduled runs:** production orders at the kitchen that are submitted, approved, cooking or awaiting sign-off, planned up to the horizon's end, overdue included. They are scaled with the same function their sign-off deducts with (`consumptionByMaterial`). Drafts are not counted | A draft is not yet a plan. A run's ingredients leave the shelf only at sign-off (Week 6), so an overdue run still needs them |
| R3 | **On order:** open purchase requests (draft, pending, approved, not yet ordered) and purchase orders with nothing received yet (draft to sent) **whose notes, or whose request's notes, name exactly this kitchen**. Open lines that name no kitchen are shown, not counted. A partly received order's remainder is not counted | Purchase requests and orders have no "deliver to" yet (gap noted in the Week 10 plan: "the kitchen goes in the PR note"). The pre-filled note names the kitchen, so a saved reorder counts at once. The history has 76 partly received orders never made good; counting them would hide real needs |
| R4 | **Supplier:** the one on the material's latest purchase order (rejected and cancelled ones aside), else its latest supplier price. **Lead time:** that supplier's, from Task 3 (measured, then promised, then 2 days), with its source shown | Gap 1 of the Week 10 plan |
| R5 | **Only 🔴/🟡 kitchen tiles get a recommendation**, and the API refuses others (409) | The roadmap's trigger is "drops below reorder point" |
| R6 | **The explanation is asked for, not automatic:** an Explain button, queued on the `ai` queue like Features 1, 3 and 6. One insight per kitchen and material (`REORDER_RECOMMENDATION`, `'StockPosition'`, `'<branchId>:<materialId>'`). The figures shown are always worked out fresh; the stored facts keep a check of on hand, on order, the order and its date, and the panel says when those have moved | Plan P5 said "on first open". A popup opened by every role on a page that refreshes every 30 s would spend on views, and the numbers are free and immediate anyway. P4's "figures changed" check is kept |
| R7 | **Who:** everyone who can see Stock Levels sees the recommendation and any explanation. **Explain / Regenerate:** ADMIN, PROCUREMENT_MANAGER, PRODUCTION_MANAGER (those who order and those who cook). **Create purchase request:** the roles allowed on `/procurement`, so everyone but VIEWER | Accounting approves purchase requests and reads; it does not ask. The button follows the page's own guard |
| R8 | **"Create purchase request", not "Create Purchase Order"** (P8, owner 2026-11-21): the form opens pre-filled (`/procurement/requests/new?reorder=<branchId>:<materialId>`) and is worked out again when it opens. Nothing is created until Save | A purchase order comes only from an approved request; a button that made one would skip accounting |
| R9 | **The stock map covers active kitchens only** (`InventoryService.stockMap` reads `findActiveKitchens`). The Stock Levels filter lists kitchens. Branch Inventory's `materials` is null for an outlet, and its headline shows "None held". The daily low-stock summary reads the same map, so it is fixed with it | Owner, Task 1: outlets never hold raw materials (Week 9 Task 8). One change at the source fixes all three places |
| R10 | Sonnet 5.5, effort `low`, max tokens 2,000; 3–5 sentences under 120 words; dates given as "Tue, Nov 24" so the text reads like the popup. Measured at **$0.0055** an explanation | The Feature 1 pattern |

## What changed

- *4.1 Kitchens only.*
  - `services/inventory.service.ts`: `stockMap` covers kitchens.
  - `services/branch-inventory.service.ts`: `materials` headline null at an outlet.
  - `components/inventory/BranchHeadline.tsx`: "None held".
  - `app/(protected)/inventory/branches/[code]/page.tsx`: no raw-material section or links at an outlet.
  - `app/(protected)/inventory/stock/page.tsx`: kitchen picker and wording.
- *4.2 The figures.*
  - `repositories/reorder.repository.ts` (new): `usage`, `openPurchaseLines`, `suppliers`.
  - `repositories/production-order.repository.ts`: `findScheduledAtBranches`.
  - `services/production-order.service.ts`: `scheduledUse`.
  - `services/supplier.service.ts`: `defaultLeadTime`.
  - `services/reorder.service.ts` (new): `forAlerts`, `forPosition`, `purchaseRequestPrefill`.
- *4.3 The explanation and the UI.*
  - Migration `20261123150000_reorder_recommendation`.
  - `lib/claude.ts`: the feature's settings.
  - `lib/queue.ts`: `REORDER_EXPLAIN`, `ReorderJob`.
  - `worker/index.ts`: handler and give-up.
  - `services/ai-insight.service.ts`: registry entry.
  - `repositories/ai-insight.repository.ts`: `findMany` (with facts).
  - `services/reorder.service.ts`: `request`, `explain`, `giveUp`.
  - `components/inventory/ReorderPanel.tsx` (new) and `StockMap.tsx` (a `reorder` prop).
  - The stock page's Recommended order column.
  - `app/(protected)/procurement/requests/new/page.tsx`: `?reorder=`.
- *4.4 Docs.* This note; `progress.md`; the roadmap; `api.md`, `database.md`, `architecture.md`, `overview.md`.

## Database

Migration `20261123150000_reorder_recommendation`, additive: `AiFeature` and `AiInsightType` gain
`REORDER_RECOMMENDATION`. No new table. Still 35 models.

## API

- `POST /api/ai/insights` accepts `type: 'REORDER_RECOMMENDATION'`, `referenceId: '<branchId>:<materialId>'`.
  - 400 a malformed position.
  - 403 roles other than ADMIN, PROCUREMENT_MANAGER, PRODUCTION_MANAGER.
  - 409 not a kitchen material at or below its reorder point.
- Page `/procurement/requests/new?reorder=<branchId>:<materialId>` pre-fills the form (no endpoint change).

## UI

As listed at the top. AI Settings lists "Reorder recommender".

## Configuration

None. After pulling: `npx prisma migrate dev`, then restart `npm run dev` and `npm run worker`.

## How to test

Test data kept for you: **PRD-000561**, a submitted 12-batch Lechon catering run at Las Piñas for Nov 24 (made by
Maria through the API). Without it, Garlic and Red Onion are low but last until Nov 29–30. With it, both run short
tomorrow.

1. As **Juan** (procurement): Stock Levels.
   - Only the three kitchens are shown, with 2 reorder alerts (before: 59).
   - The Recommended order column: Garlic 11 kg, Red Onion 16 kg, both "by today · 1 day late even today".
2. Click **Red Onion** at Las Piñas.
   - The working: 1.013 kg a day; Nueva Ecija Fresh Produce, 2 days measured over 76 orders; expected use 14.104 kg
     over 9 days (scheduled runs on 1 day); + 8 safety stock − 6.375 on hand − 0 on order = 16 kg.
   - Runs: PRD-000561 needs 6 kg on Nov 24.
   - The amber note says Nueva Ecija was flagged short last month.
   - "Why this order" is already written.
3. Click **Garlic**: 11 kg. It shows that PR-000002 and PO-000001 (your earlier test documents) name no kitchen, so
   they are not counted. Press **Explain** (under a cent).
4. **Create purchase request →** on Red Onion: the form shows 16 kg Red Onion, needed by Nov 24, and the note
   "Reorder for Las Piñas Commissary — KitchenAI…". Save it.
   - Back on Stock Levels, Red Onion shows "Covered by what is on order", with PR-0002xx under "Already on order".
   - The explanation says the figures have changed. Regenerate.
5. **Branch Inventory → Alabang Outlet:** Raw materials "None held". No raw-material tiles, no Stock Levels or Stock
   Ledger links.
6. As **Liza** (accounting): the popup shows the recommendation and the button, but no Explain. As **Ana** (viewer):
   neither button.

What Claude checked (2026-11-23):
- **Figures by hand and in SQL:**
  - Garlic used 18.93 kg and Red Onion 30.392 kg in Oct 24 – Nov 22 (an independent SQL sum agrees).
  - 0.631 and 1.013 a day.
  - Before the catering run: 7 kg by Nov 28 and 11 kg by Nov 27.
  - With it: 11 kg and 16 kg, both late by 1 day.
- **Explanations:** $0.0055 each, about 2.5 s. Every number quoted is in the facts. Regenerate kept the earlier text
  until the new one was written.
- **Refusals:**
  - accounting → 403
  - viewer and branch manager → redirect
  - a healthy tile, an outlet, an unknown material → 409
  - a malformed position → 400
  - a second request while writing → `queued: false`
- **On order:** a saved pre-filled request turned Red Onion to "no order needed" and flagged the explanation as
  outdated. That test request was then deleted.
- **Pages per role:** Stock Levels (explain: admin, procurement, production; request: all but viewer); the pre-fill
  for procurement and branch manager; viewer redirected; a junk `?reorder=` gives the empty form. Branch Inventory:
  outlets "None held", kitchens their tiles and recommendations.
- **Checks:** `tsc`, `eslint`, no schema drift.

## Risks, assumptions, follow-ups

- **The kitchen is read from notes.** A request whose notes do not name a kitchen is not counted as on order for any
  kitchen (the popup lists it). A real "deliver to" on purchase requests and orders is the proper fix: a schema change
  across procurement, left as a follow-up.
- **One reorder point per material**, shared by all kitchens (as before). A per-kitchen one would sharpen safety stock.
- **Partly received orders are treated as closed.** If a supplier does deliver the rest later, the recommendation
  will have over-ordered by that much; a "close short" action would make this explicit.
- **Usage is the last 30 days**, so a holiday spike inside the window raises it for a month (All Saints' Day here).
  Feature 5 (demand forecast) is the place for calendar effects.
- **The order is rounded up to a whole unit.** That is fine for kg and pieces; a material bought in packs would need a
  pack size.
- **A recommendation exists only for 🔴/🟡 tiles.** A healthy tile that a big scheduled run will empty before the lead
  time is not flagged; the Decision Simulator (Task 6) is where that shows.
