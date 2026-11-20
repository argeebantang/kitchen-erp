# 2026-11-20 — AI write actions (Week 9, Task 5)

Week 9 roadmap task "AI WRITE ACTIONS: 2 action functions — create_purchase_request, create_production_order — so
the assistant can act, not just answer. Confirm-before-execute." It finishes the query log task too: the plan's
`ai_query_log` gains the action type, confirmed or cancelled, and the created document. It builds on the dashboard
assistant (`docs/2026-11-19-week9-nl-query.md`) and its log (`docs/2026-11-20-week9-ai-query-log.md`).

What it gives:
- **"Mag-order ng 150 kg na pork belly"** → Claude drafts a purchase request. The panel under its answer shows:
  - the lines at their reference price, with an estimated total
  - the needed-by date and the note
  - **Create draft request** and **Cancel**
- **"Gawa tayo ng 2 batch ng Bopis bukas"** → Claude drafts a production order. The panel shows:
  - batches × the recipe's batch size, the date, Main Commissary
  - every ingredient with what is needed, available and short (short in red)
- **Nothing is created until the person who asked clicks Confirm.** Confirm creates a DRAFT document under their
  name, through the same service as the form. They open it from the panel and submit it for approval as usual. No
  approval step is skipped.
- **Admin → AI Settings → Assistant questions** shows each draft: what it contained, whether it was confirmed,
  cancelled or expired, and the document it created.

Built in subtasks 5.1–5.4. Steps are in `docs/week9-task5-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| I1 | Claude calls `draft_purchase_request` / `draft_production_order`. The server checks and stores the draft and creates nothing. Confirm creates the document; Cancel discards the draft | Claude can never create anything by itself, whatever it is told. The roadmap names were `create_*`; `draft_*` says what the tools actually do |
| I2 | The draft is stored on the server, on its question's `AiQuery` row (`actionDraft`). Confirm sends only the question id and the decision | The browser cannot change what gets created. The log keeps exactly what was proposed |
| I3 | Confirm creates a **DRAFT** purchase request / production order through `PurchaseRequestService.create` / `ProductionOrderService.create`, as the user | Same rules, numbering and approval flow as the forms. The user reviews the document and submits it themselves |
| I4 | Claude passes names ("pork belly", "Bopis"). The server matches active materials / finished goods: an exact name or code, or the only one containing every word. Several or none → Claude gets the candidates and asks the user | Claude never handles ids, and an ambiguous name ("pork") is asked about instead of guessed |
| I5 | Only ADMIN and PRODUCTION_MANAGER get the tools, and the role is checked again at Confirm. ACCOUNTING asks questions only | The roles that can create production orders. Accounting approves documents, so it should not raise them |
| I6 | **Purchase request:** quantity in the material's own unit, and the unit Claude was given must be that unit, or Claude asks (it never converts). Priced at the reference price; Confirm saves that price. Needed-by only if the user said. **Production order:** batch size from the active recipe unless the user gave one; Main Commissary (the oldest active commissary); the date is required, so Claude asks if there is none. The draft is checked under exactly the rules of Create (`ProductionOrderService.check`), and its shortages come from the form's `previewRequirements` | Unit mistakes on a purchase are expensive. A draft that Confirm would refuse is refused when it is drafted, with the reason for Claude to relay |
| I7 | Only the asker can confirm, once, within 24 hours. One draft per question | Stamping `actionDecidedAt` is the claim, so a double click creates one document. A failed create gives the claim back so Confirm can be tried again |
| I8 | "Expired" is derived (PROPOSED and older than 24 hours), not stored. The log page shows each action | Nothing has to run to expire drafts |
| I9 | Claude only drafts and says so: it never says anything was created. Follow-up questions carry what became of the draft ("confirmed, PRD-000005 created as a draft order") | The panel is not part of the conversation Claude sees. Without this, "did it go through?" would be answered blind |
| I10 | Test documents get notes `claude test …` and are deleted on "clean up" | — |

## What changed

- *5.1 The columns.*
  - Migration `20261120150000_ai_actions` (see Database).
  - `AiQueryRepository`: `proposeAction` (one per question), `findAction`, `claimAction`, `releaseAction`,
    `completeAction`. Each is one conditional `updateMany`.
- *5.2 Purchase requests.*
  - `services/assistant-action.service.ts` (new): `draftPurchaseRequest`, `forQuery`, `decide`, `toDto`.
  - `MaterialRepository.searchActive`.
  - `services/assistant-tools.ts`: the `draft_purchase_request` tool. Tools now get an `AssistantToolContext`
    (who is asking plus `queryId`, the question a draft is stored on) and a `kind` (`lookup` / `draft`). Drafts are
    not listed under "Looked up".
  - `AssistantService`: instructions for drafting, and the answer carries `action`.
  - `POST /api/ai/assistant/actions/[id]` (new).
  - `components/ai/AssistantActionPanel.tsx` (new), shown under the answer. `AssistantCard` adds what became of a
    draft to the history it sends.
- *5.3 Production orders.*
  - `draftProductionOrder`. One name matcher for materials and products.
  - `FinishedGoodRepository.searchActive`, `BranchRepository.findMainKitchen`.
  - `ProductionOrderService.check`: the private `validateOrder` made callable without saving.
  - The `draft_production_order` tool, and the panel's production order view.
- *5.4 The log page and docs.*
  - `/admin/ai/questions`:
    - the summary line shows "production order draft confirmed → PRD-000005" and the like
    - an expanded row shows what was drafted and links the document
  - `AiQueryService` / repository select the action columns.
  - This note, `progress.md`, `database.md`, `api.md`, `architecture.md`, `overview.md`, the roadmap.

## Database

Migration `20261120150000_ai_actions`, additive only:
- Enums:
  - `AiActionType` (`PURCHASE_REQUEST`, `PRODUCTION_ORDER`)
  - `AiActionStatus` (`PROPOSED`, `CONFIRMED`, `CANCELLED`)
- `AiQuery` gains nullable columns:
  - `actionType`, `actionStatus`
  - `actionDraft` (JSONB): exactly what Confirm creates, with names and, for a production order, the stock check at
    drafting
  - `actionProposedAt`, `actionDecidedAt`
  - `actionDocumentId`, `actionDocumentNumber`

    The document columns have no foreign key: they point at one of two tables, and the number keeps the log readable
    if a document is ever removed.

Still 32 models. Existing questions keep the columns null. `kitchen_ai_reader` still has no grant on `AiQuery`.

## API

- `POST /api/ai/assistant`: the 200 response adds `action` — the drafted document, or null. Its fields:
  - `id`: the question id
  - `type`: `PURCHASE_REQUEST` or `PRODUCTION_ORDER`
  - `status`: `PROPOSED`, `CONFIRMED`, `CANCELLED` or `EXPIRED`
  - `expiresAt`, `decidedAt`
  - `document`: `{ number, href }` or null
  - `draft`
- **New** `POST /api/ai/assistant/actions/[id]`, body `{ decision: 'confirm' | 'cancel' }`. Roles:
  - the `/api/ai/assistant` guard admits ADMIN, ACCOUNTING and PRODUCTION_MANAGER
  - the service then allows only ADMIN and PRODUCTION_MANAGER

  Responses:
  - 200 `{ action }`
  - 400: the body is invalid, or the document service refused it (the message is shown)
  - 403: the role cannot draft
  - 404: not found, or not the caller's draft
  - 409: already confirmed, cancelled, or a Confirm in progress
  - 410: expired
  - 422: the draft cannot be read

  Refusals include `{ error, action }`, so the panel shows the draft's current state.

## UI

- Dashboard → Ask KitchenAI, for admin and production: the draft panel under an answer. Its states:
  - "not created yet", with the buttons and "Confirm by <time>"
  - "created", with a link to the document
  - "cancelled" or "expired"
- Admin → AI Settings → Assistant questions:
  - drafts on the summary line
  - a "Drafted" block in the expanded row

## Configuration

None. Restart `npm run dev` after deploying, for the regenerated Prisma client.

## How to verify

1. As production, ask "Mag-order ng 20 kg na garlic, note claude test". Check the panel, click Create draft request,
   then open the PR. It should be DRAFT, under your name.
2. Ask "Gawa tayo ng 1 batch ng Dinuguan sa Lunes". The panel should show 1 × 10 kg, Main Commissary and the
   ingredients, with short ones in red. Confirm opens a DRAFT PRD.
3. Ask "Pa-order ng 10 kg ng pork" or "Magluto tayo ng Lechon". Claude should ask which pork, or how many batches
   and when. No panel.
4. As accounting, ask to order something. Claude should say it cannot create anything.
5. As admin, open Assistant questions. Each draft shows with its outcome and document.

What Claude checked, with real questions:
- **Drafting:** pork belly 150 kg drafted at ₱380 (₱57,000).
- **Asking instead of guessing:**
  - "pork" → asked which of five
  - "2 sako garlic" → asked for kg
  - Lechon with no date → asked
  - Nov 18 → refused as past, by Claude and by the server
- **Confirming:**
  - a double click created one PR
  - another user → 404; accounting → 403
  - after confirm, cancel → 409
  - a failed create released the claim; an expired draft → 410; cancel then confirm → 409
  - Bopis 2 × 8 kg confirmed as PRD-000005 with the right recipe, branch and date
- **Follow-ups:** "did it go through?" was answered from the history note. A request for the shortages became a PR
  draft.
- **Admin page:** matches the database.
- tsc and lint are clean, and there is no schema drift.

## Risks, assumptions, follow-ups

- **A draft's prices and stock check are as of when it was drafted.** A purchase request saves the price shown. A
  production order re-pins the recipe active at Confirm, as the form does, so its ingredients can differ from the
  panel if the recipe changed in between. The created document shows the current figures.
- If recording the decision fails after the document is created, the claim stays and no second document can be
  made. The server log names both, and the log row stays "being confirmed".
- Production is planned at the oldest active commissary only. A second kitchen would need a kitchen field on the
  tool.
- Units are matched literally (kg, kilogram, kilograms). "Kilos" makes Claude ask or retry with kg.
- Only two document types. Purchase orders, transfers and write-offs need their own draft tool and panel. The
  roadmap's "one-click Create Purchase Order" on the stock map (Week 10) can reuse this confirm flow.
