# 2026-11-23 — KitchenAI consistency sweep and the head-office dashboard (Week 10, Task 7)

The last Week 10 task. It checks the week against its roadmap items and deliverable:
- "All AI features are clearly labeled with an AI badge in the UI".
- "Each insight has a 'Regenerate' button".
- "Head office dashboard shows 7 live AI insights — waste patterns, reorder suggestions, demand forecasts, supplier
  flags … with reorder suggestions clickable straight from the stock map. Simulate tomorrow's production before
  committing to it".

It fills what was missing. No schema change.

What it gives:
- **Dashboard → KitchenAI insights:**
  - A tile per AI feature the role may use, numbered as on the roadmap. Each has a headline worked out by the system
    and a link:
    1. Cost variance: the latest signed-off run's cost per kg against the one before, and whether it is explained.
    2. Ask KitchenAI: what it answers and drafts (the box is at the top of the page).
    3. Waste: pesos lost in 30 days and the share of production cost.
    4. Reorder: how many to order, the most urgent first ("Garlic at Las Piñas Commissary, 11 kg today, 1 day late
       even so").
    5. Demand: tomorrow's batches still to plan, per kitchen, and the holiday if there is one.
    6. Suppliers: who was flagged last month and for what.
    7. Simulator: a link to simulate tomorrow's run.
  - Below the tiles, the waste and supplier reports in full, as before.
- **The four stat cards are live** (placeholders since Week 1). Each links to its page where the role can open it:
  - purchase requests to approve
  - production runs today (done, cooking, to start)
  - finished-goods lots to use first (expired, expiring within 48 h)
  - raw materials to reorder (out, low, at the kitchens)
- **AI badge** on the assistant ("Ask KitchenAI") and on the documents it drafts ("Drafted by AI").
- **AI Settings:** per feature, failed calls and the average cost a call, beside the calls and spend.
- **Roadmap:** Week 10 done (the AI badge and Regenerate items too); Week 11 next.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| C1 | **Tiles, not seven more cards.** Each tile is the feature's headline and a link to where it lives (the stock map popup, the Plan page, the order page). Waste and supplier keep their full cards below | The detail already exists where the work is done. Seven full cards would make the dashboard unreadable |
| C2 | **No Claude call on the dashboard.** Every headline is a figure the code works out, or a stored insight's state | Reading the dashboard costs nothing |
| C3 | **Each tile follows the roles of what it links to:** cost variance, demand and simulator for ADMIN, PRODUCTION_MANAGER, ACCOUNTING; reorder for every role but branch manager; waste and suppliers as their cards (owner, 2026-11-21); the assistant as before | Nobody is shown a link they cannot open |
| C4 | **A branch manager gets no stat cards or tiles.** They are company-wide figures, and the owner kept company-wide insights from branch managers. Their branch is on Branch Inventory | Consistent with the Week 10 role decision |
| C5 | **Regenerate stays on stored insights only.** The assistant's answers and the simulator's explanation are not stored; asking again is their regenerate. Both now carry the badge | A Regenerate button with nothing stored to replace would be the same as asking again |
| C6 | **The stock map is read once per dashboard** for both the reorder card and the reorder tile | One query fewer on the landing page |

## What changed

- `repositories/dashboard.repository.ts` and `services/dashboard.service.ts` (new).
- `components/ai/KitchenAiOverview.tsx` (new).
- `app/(protected)/dashboard/page.tsx`: live stat cards, the tiles, `#waste` / `#suppliers` anchors. The "No activity
  yet" placeholder is gone.
- `components/ai/AssistantCard.tsx`, `AssistantActionPanel.tsx`: the AI badge.
- `repositories/ai-call.repository.ts` (`spendByFeatureSince` groups by outcome too), `services/ai.service.ts`
  (`failed`, `averageUsd`), `app/(protected)/admin/ai/page.tsx` (two columns).
- Docs: this note, `progress.md`, the roadmap, `architecture.md`, `overview.md`.

## Database, API, configuration

None.

## How to test

1. As **Admin**: Dashboard.
   - The stat cards read 4 / 5 / 25 / 2 on the current data, and each opens its page.
   - Under **KitchenAI insights**, seven tiles, 1–7. For example: reorder "Garlic at Las Piñas Commissary, 11 kg
     today", demand "Pasig 2 · Las Piñas 3 · Main 3", suppliers "Nueva Ecija Fresh Produce (short); Divisoria Dry
     Goods Trading (late)".
   - Their links go to the order, the stock map, Plan, the simulator and the reports below.
2. As **Maria**: six tiles (no supplier report). As **Juan**: reorder and suppliers. As **Ana**: waste, reorder,
   suppliers. As **Pedro**: no stat cards or tiles.
3. The assistant box shows the **AI** badge; ask it to draft something and the draft shows "Drafted by AI".
4. **AI Settings:** Failed and Average a call columns per feature.

What Claude checked (2026-11-23):
- The dashboard for all six roles over HTTP: the tile numbers per role as above; Pedro sees no tiles and no stat cards.
- The stat cards against the data: 4 purchase requests pending, 5 runs today, 2 reorder alerts.
- The reorder tile says "1 to order" because Red Onion is covered by your PR-000246.
- AI Settings lists the two new columns and all seven features.
- **Checks:** `tsc`, `eslint`, no schema change.

## Cleanup (end of Week 10)

`npm run seed:history -- --clean` was extended for what Weeks 10's later tasks added (`prisma/history/clean.ts`):
- **AI reports from the history** are deleted: the waste, supplier, reorder and plan insights about a history kitchen
  or written from figures naming a history branch or supplier. The `AiCall` rows (what was spent) stay.
- **New refusal:** your purchase requests or orders for a history kitchen ("Deliver to", Task 4).

Run on 2026-11-23, at the owner's request.
- **Removed first, by hand:** PRD-000561 (the Task 4 catering run, with its status log and 3 notifications) and
  PR-000246 (the owner's test reorder for Las Piñas).
- **The clean then removed** 556 production orders, 232 purchase requests, 7,428 stock movements, 6 AI insights,
  5 branches, 2 suppliers and the 6 history staff, among others.
- **Also removed by hand:** today's 06:00 low-stock and expiry alerts (4 notifications). They described the history
  ("59 materials need reordering").
- **Afterwards:**
  - Every table in the Task 1 snapshot is identical to before the history; the only difference is the new
    `sls_number_seq`.
  - Stock levels match the ledger.
  - The 18 holidays and the 155 `AiCall` rows remain.
  - Dashboard, Stock Levels, Plan, AI Settings, Holidays, Branch Inventory and Costing all load.

## Risks, follow-ups

- **The dashboard reads more now** (stock map, three forecasts, the finished-goods lots) on each visit. It is fine at
  this size. If it slows down, the tiles can be cached for a minute.
- **The expiry card counts every branch's lots**, outlets included, as Finished Goods does.
- **Formatting:** pesos show as on the other cards (no thousands separators, e.g. ₱67791.75), so the whole app stays
  consistent. A separator everywhere is a small follow-up.
