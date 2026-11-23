# 2026-11-23 — Decision Simulator (Week 10, Task 6)

Week 10 roadmap task "FEATURE 7 — Decision Simulator: what-if panel on the production planning and costing screens. User
sets a hypothetical ('run 5 batches of Dinuguan and 3 of Bopis tomorrow') and the system simulates it against live BOM,
stock and price data — which ingredients fall short and by how much, total batch cost, resulting cost per kg, and the
stock position after the run. Claude explains the outcome and recommends an adjustment. Read-only: nothing is written to
inventory, but an accepted scenario can be handed straight to a real Production Order."

It sits on Task 5's Production → Plan page (`docs/2026-11-23-week10-demand-forecaster.md`). The branch was cut from Task
5's branch, because the page is not on main yet.

What it gives:
- **Production → Plan → Simulate a run** (below the plan; ADMIN, PRODUCTION_MANAGER, ACCOUNTING):
  - Goods and batches for the kitchen and day picked above, **starting from the plan's batches**. Add, remove, or
    "Reset to the plan above".
  - **Simulate** (free, instant):
    - A verdict line: it can run, or how many ingredients are short; total cost and cost per kg.
    - **Per good:** planned (batches × batch size), cost at the day's reference prices, cost per kg planned, the
      kitchen's yield and the expected output, the **cost per kg that actually comes out**, and the **most batches
      the stock allows** (red when below what was asked). **Create order →** opens the production order form
      pre-filled.
    - **Per ingredient**, shortest first:
      - what it needs
      - what is free now (on hand − what approved runs still need)
      - short by how much
      - where stock ends after the run, with 🔴/🟡 against the reorder point
      - cost
      - which goods use it
  - **Simulate and ask KitchenAI** (about a cent, a few seconds): Claude explains the outcome and recommends one
    adjustment taken from the figures. For example: "Cut Dinuguan to 6 batches, the most the stock allows, or order the
    6 kg of Pork Belly and 1.5 L of Pork Blood before the run." Not saved.
- **Costing** gains a "Simulate a run before planning it →" link (not for VIEWER, who cannot open Production).

Built in subtasks 6.1–6.3. Steps are in `docs/week10-task6-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| S1 | **Measured exactly as a real order:** the recipe scaled by `consumptionByMaterial` (what sign-off deducts); free stock = on hand − what approved, in-progress and completion-pending runs still need (`committedAtBranch`, the order page's own stock check, now exported); prices are the reference prices in force at the end of the day (as `costRun`); the active PRODUCTION recipe at its batch size | A simulation that disagreed with the order it becomes would be worse than none |
| S2 | **Read-only.** Nothing is stored: no table, no insight. The explanation is one `AiCall` (`DECISION_SIMULATOR`) against the user | Plan P5: a what-if is not a record. The AiCall keeps the cost and who asked |
| S3 | **The adjustment comes from the code's figures:** per good, the most batches the free stock allows with the other goods as entered (the tightest ingredient decides). Claude picks among cutting, ordering the shortfall, or going ahead, and says which figure it rests on | Code computes, Claude explains and recommends (P1) |
| S4 | **Cost per kg out:** cost ÷ (planned × the kitchen's 30-day yield on that good). Shown beside cost per kg planned | "Resulting cost per kg" means what a kg sold costs. Las Piñas Bopis is ₱155.29 planned, ₱171.17 out |
| S5 | **Synchronous**, like the assistant: `POST /api/production/simulate` returns the simulation, and with `explain` Claude's text, in the same response. An AI failure still returns the simulation, with the reason | Seconds, not minutes; no polling for something that is not stored |
| S6 | **Who:** simulate and explain — ADMIN, PRODUCTION_MANAGER, ACCOUNTING (accounting reaches it from Costing). **Create order** — ADMIN, PRODUCTION_MANAGER (the `/production/orders/new` guard) | Costing is accounting's screen; ordering is the kitchen's |
| S7 | **Limits:** a day from today to +14; 1–8 goods, each once; 1–50 batches; an active kitchen; goods with an active production recipe | The same window as the plan; outlets do not cook |
| S8 | **Pending runs are not committed** (same as the order page): submitted, not yet approved, runs do not reduce free stock | One rule for "free"; a pending run may be rejected |

## What changed

- *6.1 Simulation.*
  - Migration `20261123200000_decision_simulator` (`AiFeature` gains `DECISION_SIMULATOR`).
  - `services/production-order.service.ts`: `consumptionByMaterial` exported; `committedAtBranch` extracted from the
    stock check and exported. The stock check uses it, with no change in behaviour.
  - `services/decision-simulator.service.ts` (new): `goods`, `simulate`, `explain`.
  - `app/api/production/simulate/route.ts` (new); middleware guard.
  - `lib/claude.ts`: the feature's settings.
- *6.2 The panel.*
  - `components/production/DecisionSimulator.tsx` (new) on `app/(protected)/production/plan/page.tsx`.
  - The Costing link.
- *6.3 Docs.* This note; `progress.md`; the roadmap; `api.md`, `database.md`, `architecture.md`, `overview.md`.

## Database

Migration `20261123200000_decision_simulator`: `AiFeature` gains `DECISION_SIMULATOR`. No table. 36 models.

## API

**New** `POST /api/production/simulate`.
- Body: `{ kitchenId, date: YYYY-MM-DD, lines: [{ finishedGoodId, batches: 1–50 }] (1–8), explain? }`.
- Success: 200 `{ simulation, explanation: { text, model, costUsd } | null, explainError? }`.
- Errors:
  - 400 validation: a day outside today … +14, an outlet, a good twice, a good with no active recipe, or extra fields.
  - 403 `explain` for another role.
- Guard: ADMIN, PRODUCTION_MANAGER, ACCOUNTING. Writes nothing.

## UI

As listed at the top. AI Settings lists "Decision simulator".

## Configuration

None. After pulling: `npx prisma migrate dev`, then restart `npm run dev`.

## How to test

1. As **Maria**: **Production → Plan** → Las Piñas Commissary, tomorrow. Below the plan, **Simulate a run** starts with
   the plan's batches. Press **Simulate**:
   - It can run; the ingredients that would end 🟡 are flagged.
   - Bopis costs ₱155.29 a kg planned and ₱171.17 a kg out (90.7 % yield).
2. Make it **8 Dinuguan + 3 Bopis** → **Simulate**:
   - "2 ingredients are short": Pork Belly short 6 kg, Pork Blood short 1.5 L, both 🔴 after.
   - Dinuguan's "most batches the stock allows" is **6**, in red.
   - Total ₱18,970.98, ₱182.41 per kg.
3. **Simulate and ask KitchenAI**: Claude advises cutting Dinuguan to 6 batches or ordering the shortfall first, citing
   the figures.
4. **Create order →** on a line: the production order form opens pre-filled. Nothing was created until you save it.
5. As **Liza** (accounting): **Costing** → "Simulate a run before planning it →". She can simulate and ask, but sees
   no Create order.
6. As **Ana** (viewer): no link on Costing. Juan (procurement) cannot open Plan.

What Claude checked (2026-11-23):
- **Cost:** one Bopis batch ₱1,242.33, equal to an independent SQL sum of its 14 recipe lines at the reference prices
  of Nov 24.
- **Free stock** subtracts approved runs: Garlic 4.6 on hand − 0.42 for today's runs = 4.18.
- **8 Dinuguan + 3 Bopis:** Pork Belly needs 32 kg against 26 free (30 on hand − 4 committed) → short 6. Pork Blood
  20 against 18.5 → short 1.5. At most 6 Dinuguan.
- **Explanation:** $0.0074, 2.4 s, logged against Liza. Every number it quotes matches the simulation.
- **Refusals:**
  - a good twice, an outlet, 0 or 60 batches, a past day, an extra field → 400
  - viewer and procurement → redirect
- **Pages:** production gets the simulator with Create order; accounting gets the simulator without Create order;
  Costing shows the link to accounting, not to the viewer.
- **Checks:** `tsc`, `eslint`, no schema drift. The order page's stock check is unchanged (`committedAtBranch` is the
  same loop, moved).

## Risks, assumptions, follow-ups

- **Deliveries due are not counted**, as on the order page: a purchase arriving before the run still shows as short.
  The Reorder Recommender's popup is where on-order quantities show.
- **Pending runs are not counted** (S8); two simulations of the same stock do not know about each other.
- **Batch size is the recipe's.** The order form can change it, the simulator cannot. That is enough for "how many
  batches".
- **The explanation is not kept.** To see it again, ask again (about a cent).
