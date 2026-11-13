# 2026-11-13 — Branch management (Week 8, Task 1)

Week 8 roadmap task "Branch management: create and manage branch profiles" — the first task of Week 8
(Branch Distribution & Costing Dashboard).

Admins can now:
- add branches
- edit their profile (code, name, type, address, phone)
- give each branch its one manager
- deactivate a branch that no longer operates

Before this, the only branch was the seeded Main Commissary, and nothing could add another. The
transfers that come next (Task 2 onwards) need at least two branches, and need to know which one supplies
and who confirms receipt.

Built in subtasks 1.1–1.4. The user asked Claude to test 1.2–1.4. Each was verified through the API calls
the tab makes, with SQL and with the rendered page. The test steps and results are in the tracker,
`docs/week8-task1-subtasks.xlsx` (not in git).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| B1 | Profile: name (unique), code (unique, 2–10 letters/digits, fixed once created), type Commissary / Outlet, address, phone, active | A short code reads well in tables and transfer documents; the type tells transfers who sends and who receives. |
| B2 | Master Data → new Branches tab, list + New / Edit popup, like Finished Goods | Same pattern as the rest of the item master. A per-branch page comes with Task 5 (each branch's own inventory view). |
| B3 | Deactivate, never delete. Refused while the branch holds stock, has open documents, or is the last active commissary; the message names what to clear. Reactivate any time | Every inventory page and form lists active branches only, so deactivating a branch with stock would hide that stock. |
| B4 | One manager per branch: `Branch.managerId`, unique, a `BRANCH_MANAGER` user. Choosing a manager of another branch moves them. Code deciding who acts for a branch reads it from the database, not the login token | Revised after the user's answer (one manager per branch). The original proposal used `User.branchId`, which allows several managers per branch. A unique column makes the database hold the rule. Task 3 ("branch confirms receipt") needs it. |
| B5 | ADMIN manages (`/admin` guard; `/api/branches` writes ADMIN only); reading `/api/branches` is open to every signed-in user | Same rule as Master Data; later forms read branches. |
| B6 | Production, receiving, conversion and write-off forms keep offering every active branch | The user's answer: every branch has a cook, so nothing is restricted by type. |
| B7 | Migration: add nullable → backfill (Main Commissary `MAIN`, `COMMISSARY`) → `NOT NULL`; no lasting default on `type`; seed upserts on the code | The table had a row. |
| B8 | No outlets seeded; admins create them in the tab. Week 12's realistic seed adds 3 branches | Keeps the seed honest. |
| Answers | "do all recommended"; a cook in every branch; one manager per branch; no branch list given, so Main Commissary keeps its name with code `MAIN` | — |

## What changed

- *1.1 Schema and the Branches tab.*
  - New enum `BranchType` (`COMMISSARY`, `OUTLET`).
  - `Branch` gains `code` (unique), `type`, `phone`, `managerId` (unique FK → `User`, relation
    `BranchManager`, `ON DELETE SET NULL`) and `updatedAt`. `Branch.name` becomes unique.
  - The seed upserts Main Commissary on code `MAIN`.
  - `BranchRepository.findAll`; new `services/branch.service.ts` (`BranchDto`, `list`).
  - Master Data → **Branches** tab (`components/master/BranchesPanel.tsx`):
    - columns: code, name, type badge, address, phone, manager (amber "None" when unset), Active / Inactive
    - inactive branches are listed, greyed out
- *1.2 New / Edit.*
  - Endpoints: `GET /api/branches` (`?includeInactive=true`), `POST /api/branches`,
    `PATCH /api/branches/[id]`; the middleware guard makes `/api/branches` writes ADMIN-only.
  - **Code:** trimmed, upper-cased and fixed. A code sent in a PATCH is ignored.
  - **Name:** unique ignoring case.
  - **Phone:** digits, spaces, `+ - ( )`. A blank address or phone is stored as null.
  - **Duplicates:** 409 naming the clash. A race past the pre-check hits the unique index; the
    resulting Prisma `P2002` is mapped to 409, not a 500.
  - **Last commissary:** turning the only active commissary into an outlet is refused. Every
    active commissary row is locked first, so two simultaneous edits cannot both pass. In a race
    test, exactly one won in each of 3 rounds.
  - **Popup:** New branch / Edit, with the code read-only on edit. Validation errors name each
    field and its rule, instead of a bare "Validation failed".
- *1.3 Deactivate / reactivate.*
  - New endpoints `POST /api/branches/[id]/deactivate` and `/reactivate`.
  - `BranchRepository.deactivationBlockers` counts:
    - any non-zero material or finished-goods lot level (negative included)
    - production orders not completed / rejected / cancelled
    - draft or pending receiving reports
    - pending conversions and write-offs
  - The message counts each and names up to 3 document numbers, e.g. "Main Commissary can't be
    deactivated: it still holds stock — 1 raw material; and it has open documents — 4 production
    orders (PRD-000001, PRD-000002, PRD-000003, …). To deactivate it, move or use up the stock and
    finish or cancel the documents first."
  - `setActive` puts the expected state in the `UPDATE`'s `WHERE`, so a repeat returns 409. It
    takes the same commissary lock when deactivating a commissary.
  - Tab: a Ban icon (with a confirm) or a ↺ Reactivate icon; errors show in a red bar above the
    table.
- *1.4 The manager.*
  - The popup has a Manager select: "— No manager —" plus every Branch Manager user. One who runs
    another branch is listed as "— manages X". Choosing them shows an amber note that X will be
    left without a manager.
  - `managerId` on POST and PATCH (null clears; omitted leaves it). The service refuses a user
    who is not a `BRANCH_MANAGER` (400).
  - The repository clears the manager from any other branch in the same transaction as the
    assignment, after checking the target branch exists. The unique index is the final guard:
    a lost race returns 409 "That manager was just assigned to another branch".

## Files affected

- `prisma/schema.prisma`, `prisma/migrations/20261113100000_branch_profiles/migration.sql` (new), `prisma/seed.ts`
- `repositories/branch.repository.ts`
- `services/branch.service.ts` (new)
- `app/api/branches/route.ts`, `app/api/branches/[id]/route.ts`, `app/api/branches/[id]/deactivate/route.ts`, `app/api/branches/[id]/reactivate/route.ts` (all new)
- `middleware.ts`
- `app/(protected)/admin/master/page.tsx`, `components/master/MasterTabs.tsx`, `components/master/BranchesPanel.tsx` (new)
- `docs/api.md`, `docs/architecture.md`, `docs/database.md`, `docs/overview.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

## Database changes

Migration `20261113100000_branch_profiles`, hand-edited from `prisma migrate diff`:
- `code`, `type` and `updatedAt` are added nullable.
- The existing row is filled in: Main Commissary becomes `MAIN` / `COMMISSARY`. Any other existing
  branch would have become `B<n>` / `COMMISSARY`.
- Then `NOT NULL`, and unique indexes on `name`, `code` and `managerId`.
- FK `managerId → User ON DELETE SET NULL`.

No drift afterwards. The model count is unchanged at 29.

## API changes

- New: `GET/POST /api/branches`, `PATCH /api/branches/[id]`, `POST /api/branches/[id]/deactivate`,
  `POST /api/branches/[id]/reactivate`. See `docs/api.md`.
- New guard: `/api/branches` writes ADMIN-only.

## UI changes

- Master Data gains a **Branches** tab, with New / Edit (including the manager) and
  Deactivate / Reactivate.

## Configuration / environment

None. The generated Prisma client changed, so `npm run dev`, `npm run worker` and the TS server need
a restart after pulling this.

## How to verify

```bash
npx tsc --noEmit && npm run lint
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

Then as admin@, Master Data → Branches:
1. Create a branch.
2. Edit it.
3. Try to deactivate Main Commissary. It is refused, because it holds 1 raw material and 4 draft
   production orders.
4. Deactivate and reactivate the new branch.
5. Give Pedro Branch (branch@) to one branch, then to the other.

Run on 2026-11-13 with throwaway "claude test" branches:
- **Access:** viewer reads `GET /api/branches`; production and viewer writes are redirected.
- **1.2 New / Edit:**
  - validation (400 naming each field)
  - code upper-casing and immutability
  - duplicate code / name in any case (409)
  - 404 for an unknown id
- **Last-commissary rule:** refused on edit and on deactivation, and race-tested (3 / 3 rounds
  each).
- **1.3 Deactivate / reactivate:**
  - a zero level does not block; −2.5 kg and a 3 kg finished-goods lot do
  - repeats return 409
  - an inactive branch drops out of `GET /api/branches` and Stock Levels
- **1.4 Manager:**
  - assign, move, keep on rename, clear
  - production@ and an unknown user refused
  - simultaneous assignments always leave the manager at exactly one branch
  - a PATCH to a missing branch with a `managerId` no longer clears that manager elsewhere (fixed
    while testing)
- **Cleanup:** temporary branches, levels and lot deleted; Main Commissary restored exactly
  (including `updatedAt`); `Branch`, `InventoryLevel`, `StockMovement` and lot counts match the
  snapshot; `User` unchanged.
- **Not covered:** the popup's client-side behaviour (the dropdown, the amber note, the confirm
  dialog) was not clicked in a browser — no headless browser runs in this environment.

## Risks / assumptions / follow-up

- **Small deactivation race.** A document created at the very moment a branch is deactivated can
  still slip through: the creating forms check `isActive` without a lock. The document still opens,
  and the branch can be reactivated.
- **Inactive branches in filters.** Ledger and End of Day filters list active branches only, so an
  inactive branch's history is reachable through its documents, not the filter.
- **`User.branchId` is unused.** Only `/api/auth/register` sets it. Managers come from
  `Branch.managerId`. Staff membership (cooks, cashiers) is not modelled.
- **No user screen.** The sidebar's Admin → Users (`/admin/users`) has no page and 404s. A Branch
  Manager user can only be created through `POST /api/auth/register` or the seed.
- **For Task 2 onwards:**
  - Transfers should go from a commissary to an outlet.
  - Receipt is confirmed by the receiving branch's `managerId` (or ADMIN).
  - Transfers must write `TRANSFER` finished-goods movements so End of Day's "Distributed" counts
    them.
  - Open transfers must be added to `deactivationBlockers`.
