# 2026-11-20 — Kitchens only: production, conversion and receiving (Week 9, Task 8)

Task 2 of 4 in the multi-kitchen plan. The owner confirmed (2026-11-20):
- there are **several central kitchens**
- **outlets never cook** and hold no raw materials
- outlets order from any kitchen, and send unsold goods back to one

Week 8 had settled the opposite (decision B6, "every branch has a cook"), so the production, conversion and receiving
forms offered every active branch. Picking an outlet by mistake would have deducted ingredients the outlet never had,
taking its stock negative.

What it gives:
- The production order, conversion and "Receive delivery" forms offer **central kitchens only**. Their field is now
  labelled **Kitchen** ("Received at kitchen" on receiving).
- The services refuse an outlet, with one message per document:
  - "Cubao Outlet is an outlet — production runs at a central kitchen"
  - "… — conversions are done at a central kitchen"
  - "… — deliveries are received at a central kitchen"
- The rule sits in the services, so it holds everywhere they are called from:
  - the API
  - an edited draft
  - receiving's submit and approval re-checks
  - the assistant's Confirm, which closes the follow-up left by Task 7

Unchanged: write-offs (outlets still write off expired finished goods) and transfers (already commissary → branch).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| K5 | Production orders, conversion orders and receiving reports must be at an active **COMMISSARY**. Checked in `validateOrder` (production create / edit / `check`), `recipeAndBranch` (conversion preview / create) and `validateCounts` (receiving create / edit / submit / approval) | Outlets do not cook and hold no raw materials. Converting is cooking, so unsold goods go back to a kitchen first (Task 3, returns) |
| K6 | The forms list `BranchRepository.findActiveKitchens()`: active commissaries, oldest first, so Main Commissary stays the default | Nobody can pick an outlet by mistake. The service check backs this up for any other caller |
| K7 | Existing documents are not touched. The check before the change found **no** production order, conversion, receiving report or raw-material stock at an outlet (there were no outlets) | Nothing to migrate. A future outlet document from before this rule would be refused only when edited or re-checked |
| K8 | Outside this task: the schedule's branch filter, the production preview (only ever called with a kitchen from the form), write-offs, transfers | Smallest change. Filters still list every branch, which is harmless |
| — | Reverses Week 8 B6 for production, conversion and receiving | Owner, 2026-11-20 |

## What changed

- `repositories/branch.repository.ts`: `findActiveKitchens()` added. `findById()` also returns `type`.
- `services/production-order.service.ts`:
  - `validateOrder` refuses an outlet.
  - `getForm` offers kitchens only.
- `services/conversion-order.service.ts`:
  - `recipeAndBranch` refuses an outlet.
  - `getForm` offers kitchens only.
- `services/receiving-report.service.ts`:
  - `validateCounts` refuses an outlet.
  - `getForm` offers kitchens only.
- `components/production/ProductionOrderForm.tsx`, `components/production/ConversionOrderForm.tsx`,
  `components/procurement/ReceivingReportForm.tsx`: field label Branch → Kitchen.

**Database / API / config:** no migration and no new endpoints. Existing endpoints now return 400 for an outlet.

## How to test

**Test data Claude prepared** (kept until the task ends):
- **Cubao Commissary** (code `CUBK`, Commissary) and **Cubao Outlet** (code `CUB`, Outlet), address "claude test"
- **PRD-000005**: a draft Bopis order at Cubao Commissary, note "claude test"
- **PO-000001** moved from Approved to **Sent** (procurement's Send), so a delivery can be received against it.
  Cleanup puts it back to Approved.

Steps:
1. As Maria Production, open Production → New order. The **Kitchen** list shows Main Commissary and Cubao Commissary,
   and not Cubao Outlet.
2. Production → Conversions → New. Same list.
3. As Juan Procurement, open PO-000001 and choose Receive delivery. **Received at kitchen** lists the two kitchens only.
4. Open PRD-000005 and edit it. It saves at Cubao Commissary. Don't submit it.
5. Optional, the API check: in Master Data → Branches, change Cubao Commissary to Outlet, then try to save PRD-000005
   again. You get "Cubao Commissary is an outlet — production runs at a central kitchen". Change it back to Commissary.

Checked by Claude on 2026-11-20:
- `tsc` and `eslint` are clean.
- POST to `/api/production-orders`, `/api/conversion-orders` and `/api/receiving-reports` naming Cubao Outlet → 400,
  with each message above.
- All three form pages list only Main Commissary and Cubao Commissary.
- A production order at Cubao Commissary → 201 (PRD-000005).
- The assistant drafted at Cubao Commissary. The branch was switched to Outlet before Confirm, and Confirm was then
  refused with the production message. The draft stayed unconfirmed and was cancelled, and the branch was switched
  back.

Proof for the owner (2026-11-20): 9 screenshots and a 1:40 captioned walkthrough video, recorded in a headless browser
against the running app. They are not in git.

Cleanup (2026-11-21), all deleted:
- the two test branches
- PRD-000005 (`prd_number_seq` reset)
- the 14 test questions

PO-000001 was put back to Approved with its original `updatedAt`. The questions' `AiCall` spend rows were kept.

## Risks, assumptions, follow-ups

- **Editing a document at a former kitchen.** If a kitchen is changed to an outlet while it has open drafts, editing
  them fails until a kitchen is chosen. Its select shows the first kitchen, because the old branch is not in the list.
  Approvals of production orders do not re-check the branch. Receiving does, through `validateCounts`.
- Branch Managers can still raise purchase requests. Requests have no branch, so this is harmless. Whether they
  should is a separate role question.
- Next in the plan:
  - **Task 3, returns:** unsold goods from an outlet back to a kitchen
  - **Task 4, branch stock request:** an outlet orders goods from a kitchen
