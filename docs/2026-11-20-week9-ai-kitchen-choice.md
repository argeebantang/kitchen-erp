# 2026-11-20 — The assistant plans runs at the kitchen you name (Week 9, Task 7)

A fix to the AI write actions (`docs/2026-11-20-week9-ai-write-actions.md`, decision I6). `draft_production_order`
always planned at the oldest active commissary, Main Commissary. The owner confirmed (2026-11-20) how the business
works:
- there are **several central kitchens**
- **outlets never cook** and hold no raw materials
- outlets order from any kitchen, and send unsold goods back to one

With a second kitchen, "plan 3 batches of Bopis at Cubao" would have been drafted at Main Commissary without a word.

What it gives:
- **"Gawa tayo ng 2 batch ng Bopis bukas sa Cubao"** → drafted at Cubao Commissary.
- **No kitchen named:**
  - one active kitchen → that kitchen is used, as before
  - several → Claude asks which one, naming them
- **An outlet named** ("sa Cubao Outlet") → Claude is told outlets do not cook and asks which kitchen.
- The confirm panel now reads **Kitchen: Cubao Commissary**, so the user can check it before confirming.

This is task 1 of 4 in the multi-kitchen plan agreed with the owner. The other three:
- **Kitchens only:** production, conversion and receiving at commissaries only.
- **Returns:** unsold goods sent from an outlet back to a kitchen.
- **Branch stock request:** an outlet orders goods from a kitchen.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| K1 | `draft_production_order` takes an optional `kitchen`, as the user named it. The server matches it among **active commissaries**: exact name or code, else the only kitchen whose name + code contain every word. "kitchen", "commissary", "central", "branch", "the", "sa", "ng" are ignored, so "Cubao kitchen" finds Cubao Commissary | Claude never handles ids, the same as products (I4). The filler words say "a kitchen", not which one |
| K2 | No kitchen named: the only active kitchen if there is one; otherwise nothing is drafted and Claude gets the kitchen list to ask from. The tool description says never to pick one itself | The old silent default is exactly the bug. With one kitchen, asking would only be friction |
| K3 | An outlet (by name or code) is refused with "outlets do not cook" and the kitchen list. A vague word that matches a kitchen and an outlet ("Cubao") means the kitchen | Production is planned, so the kitchen is the only sensible reading |
| K4 | The confirm panel labels the kitchen ("Kitchen: …") | With several kitchens it is the field most worth checking |

## What changed

- `services/assistant-action.service.ts`: adds `matchKitchen()` (K1–K3) and a shared `wordsOf()` helper.
  `draftProductionOrder` uses `matchKitchen(input.kitchen)` instead of the fixed main kitchen.
- `services/assistant-tools.ts`: `draft_production_order` gains the optional `kitchen` input. Its description now
  says there can be several kitchens, that outlets never cook, and that Claude must ask rather than pick one.
- `repositories/branch.repository.ts`: `findMainKitchen()` is removed (its only caller is gone).
  `findAllActiveWithType()` is added: active branches with code and type, oldest first.
- `components/ai/AssistantActionPanel.tsx`: "Kitchen: <name>" on a production order draft.

**Database / API / config:** none. No migration. Drafts already store `branchId` / `branchName`, so drafts made
before this change still read and confirm as they were.

## How to test

You need two kitchens and an outlet. **Test data Claude prepared** (kept until the task ends):
- **Cubao Commissary** (code `CUBK`, Commissary)
- **Cubao Outlet** (code `CUB`, Outlet)

Both have the address "claude test". Main Commissary is unchanged.

Signed in as Admin or a Production Manager, on the dashboard assistant:
1. "Plan 2 batches of Bopis tomorrow." → Claude asks which kitchen and names Main Commissary and Cubao Commissary.
   Nothing is drafted.
2. Answer "Cubao". → The panel shows **Kitchen: Cubao Commissary**, with the stock check for Cubao (all short: it has
   no stock). Confirm → the created PRD shows branch Cubao Commissary.
3. "Plan 1 batch of Bopis tomorrow at Main." → Kitchen: Main Commissary. Cancel it.
4. "Plan 1 batch of Bopis tomorrow sa Cubao Outlet." → Claude says outlets do not cook and asks which kitchen.
5. Master Data → Branches: deactivate Cubao Commissary. "Plan 1 batch of Bopis tomorrow." → Drafted at Main
   Commissary without asking. Reactivate Cubao Commissary afterwards.

Checked by Claude: `tsc` and `eslint` are clean. The draft function was run directly against the database:
- no kitchen named → the list of kitchens
- "Main", "main kitchen", "MAIN", "Cubao", "Cubao kitchen" → matched, and the draft passed Create's checks
- "CUB", "Cubao Outlet" → refused as an outlet
- "Makati" → refused as unknown, with the list of kitchens
- "sa kitchen" → treated as no kitchen named
- one active kitchen and none named → that kitchen

Steps 1–5 above were then run by Claude at the owner's request (2026-11-20), through `POST /api/ai/assistant` as
Maria Production (Production Manager). All five passed:
- Claude asked "Main Commissary o Cubao Commissary?"
- "Cubao" drafted at Cubao Commissary, and Confirm created a DRAFT order there
- Main → Main Commissary
- the outlet was refused, and Claude asked which kitchen
- with one kitchen active, it drafted there without asking

Afterwards the test data was deleted:
- the two branches
- the test order
- the 5 test questions

`prd_number_seq` was reset. The questions' 10 `AiCall` rows were kept: they are real API spend that counts toward the
monthly budget. The panel's "Kitchen:" label was not checked in a browser.

## Risks, assumptions, follow-ups

- **Confirm does not re-check the kitchen's type.** If a kitchen is turned into an outlet within the 24 hours a
  draft lasts, Confirm still creates it there. `ProductionOrderService.create` only checks that the branch is
  active. Task 2 (kitchens only) adds the commissary rule to the service, which covers Confirm too.
- The production order form still offers every branch. That is also Task 2.
- Substring matching: "Cub" finds Cubao Commissary. Two kitchens sharing a word ("North", "North Annex") make
  Claude ask, which is the intended behaviour.
- Production Managers still plan for every kitchen (owner decision 2026-11-20). Kitchen-scoped managers would
  limit the list here too.
