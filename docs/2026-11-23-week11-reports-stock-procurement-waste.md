# 2026-11-23 — Inventory Movement, Procurement and Waste & Write-off reports (Week 11, Task 5)

This completes the roadmap item "5 reports with Excel + PDF export". The original plan said CSV; the owner chose
Excel on 2026-11-23 (see the Task 4 note). It adds the last three reports to the engine from Task 4. Each takes its
figures from the service that already computes them. That service now accepts any period, and each refactor was
proved identical to the old code.

What it gives (Reports in the sidebar; each with Excel and PDF):
- **Inventory Movement**, for any branch or all:
  - Headline figures: finished goods opening and closing value, produced, sold at outlets, written off, raw
    materials received and used, and the number of stock movements.
  - **Finished goods:** per good and branch, opening, produced, converted in and out, written off, sold,
    distributed, closing (kg) and closing value. These are End of Day's figures over the whole period.
  - **Raw materials:** per material and kitchen, opening, received, used in production, used in conversions,
    closing (kg), and the value received and used. This is the Stock Ledger summed.
- **Procurement**, company-wide:
  - Headline figures: orders approved and their value, deliveries, received, short, rejected at delivery, flagged
    suppliers, purchase requests approved and rejected.
  - **Orders approved, by supplier.**
  - **Supplier performance:** deliveries, received, short deliveries %, short value, rejected, late orders %,
    average days late, lead time promised vs actual, and flags with reasons.
  - **Materials that came short.**
- **Waste & Write-off**, for any branch or all:
  - Headline figures: written off (₱ and kg), lost in transit, lost in all, share of production cost (all
    branches), and written off in the same number of days before, with the change.
  - **By branch**, **By branch and good** (every pair, with reasons in kg and waste % of what came in), **Lost in
    transit** by route, and **Recovered in conversions**.
- **Who sees what** (owner, 2026-11-23):

  | Role | Reports |
  |---|---|
  | Admin, accounting, viewer | all five |
  | Production | Production Summary, Cost per Batch, Inventory Movement, Waste |
  | Procurement | Procurement, Inventory Movement |
  | Branch manager | Inventory Movement, **only for the branch they manage**; no "All", and another branch is refused |

## Decisions

| # | Decision | Rationale |
|---|---|---|
| S1 | **Each source service now takes any period, and nothing is recomputed:** `EndOfDayService.forPeriod` (same `dayFlows` query, row logic moved to `toFlowRows` and shared with `forDay`), `SupplierPerformanceService.periodFacts` (the monthly calculation moved to `factsFor`), `WastePatternService.periodFigures` (the weekly calculation moved to `figuresFor` and `periodWindows`) | The owner's rule. I ran the old code from git against the new: `forDay` on 3 days (one filtered to Main), supplier `facts` for 3 months, and waste `facts` for 3 weeks. All identical |
| S2 | **Raw materials: quantities balance, values are the movements' own.** Received is valued at purchase cost and used at the reference prices recorded on each movement. There's no opening or closing value | The system has never valued raw-material stock; the ledger records a value on each movement only. Inventing a valuation would be a second, made-up calculation |
| S3 | **The only new sums are ones nothing computed before:** the Stock Ledger summed per material (`InventoryRepository.periodFlows`), purchase orders approved per supplier, and purchase requests decided. The last two are read from the Approval log by decision time | Those figures existed nowhere. Everything else is a figure the app already shows |
| S4 | **Waste over any period is compared with the same number of days before** (7 days against the 7 before; 30 against 30) | The weekly report's rule (30 vs 30), applied to the period chosen |
| S5 | **Procurement is company-wide** (a branch filter is refused) | Suppliers deliver to kitchens, but their performance is judged per supplier, as in Supplier Performance |
| S6 | **A branch manager is held to the branch they manage** (`ownBranchForManagers`), read from `Branch.managerId`, not the login token. One who manages none sees a clear message | Owner, 2026-11-23. The same source of truth as Branch Inventory (Week 8) |
| S7 | **"Other" columns appear only when something fell outside the named flows** | Today every movement fits a named flow. If a new kind ever appears it still shows, and opening + flows = closing still holds |

## What changed

- **Services:**
  - `end-of-day.service.ts`: `toFlowRows()` (shared) and `forPeriod()`, plus the `EndOfDayPeriodDto` type.
  - `inventory.service.ts`: `materialFlows()`, plus the `MaterialFlowDto` / `MaterialFlowsDto` types.
  - `supplier-performance.service.ts`: `factsFor()` (shared) and `periodFacts()`.
  - `waste-pattern.service.ts`: `periodWindows()`, `figuresFor()` (shared) and `periodFigures()`.
  - `operations-report.service.ts` (new): the three builders.
  - `report.service.ts`: the three keys; a `branches` filter; `ownBranchForManagers`; `allLabel` and `branchFixed`
    for the filter bar.
- **Repositories:**
  - `inventory.repository.ts`: `periodFlows()`, one SQL statement over the ledger.
  - `approval.repository.ts`: `decisionCountsBetween()`.
  - `purchase-order.repository.ts`: `approvedBySupplierBetween()`.
- **UI:**
  - `app/(protected)/reports/[key]/page.tsx`: "All branches" / "Company-wide" wording, the branch manager's fixed
    branch, and a message for a manager with no branch.
  - `components/reports/ReportFilters.tsx`: no "All" option when the branch is fixed.
- **Guards:** `middleware.ts` admits PROCUREMENT_MANAGER and BRANCH_MANAGER to `/reports` and `/api/reports`, and the
  nav shows Reports to them.
- **Database:** none. **Config:** none. **API:** the three keys on `GET /api/reports/[key]` (see api.md).

## How to test

No restart and no new test data: the history data covers it.

1. As `accounting@kitchen.com`, Reports → **Inventory Movement** (last week, all branches):
   - Raw materials received ₱194,358.89 equals **Procurement** → Received.
   - Raw materials used ₱210,648.44 equals **Production Summary** → Production cost.
   - Finished goods: produced ₱209,361.40, written off ₱12,619.88.
2. Inventory Movement, Branch → Cubao Outlet: the raw materials table reads "Cubao Outlet holds no raw materials in
   this period".
3. **Procurement**, last week: 16 orders approved worth ₱200,345.73; 19 deliveries; ₱4,126.38 short; ₱2,652.95
   rejected. Try adding `&branch=` to the URL by hand: "This report covers every branch".
4. **Waste & Write-off**, last week: written off ₱12,619.88 (43.03 kg), lost in transit ₱1,899.30, 6.9% of production
   cost, +107.6% against the 7 days before. Then try Branch → Cubao Outlet.
5. Custom dates 2026-10-24 → 2026-11-22: the totals match Dashboard → waste report (KitchenAI) for the same 30 days.
6. **Who sees what:**
   - As `procurement@kitchen.com`: Reports lists Inventory Movement and Procurement only.
   - As `lorna.bautista@history.kitchen.com` (Cubao's manager, `password123`): only Inventory Movement, fixed to
     Cubao Outlet, with no "All".
   - As `branch@kitchen.com` (manages no branch): Inventory Movement says "You do not manage a branch yet".
7. Download Excel and open PDF on each report.

What I verified:
- **Old code from git against new:**
  - End of Day `forDay`: Nov 20 all, Nov 22 Main, Nov 23 all. Identical.
  - Supplier `facts`: Oct, Sep, Nov. Identical; October run as a period has the same totals as October as a month.
  - Waste `facts`: W48, W47, W40. Identical.
  - Waste over 2026-10-24…11-22 as a report equals the W48 weekly totals and branches.
- **Reconciliation, Nov 1 to today:**
  - **Finished goods:** 24 rows, all balanced, every closing equal to today's stock levels.
  - **Raw materials:** 63 rows, every closing equal to today's stock level. Opening + flows = closing on every row,
    to 3.5 × 10⁻¹⁹ kg. Conversions record repeating decimals, and Postgres sums them exactly. My first check, re-added
    in JavaScript at 20 significant digits, flagged 6 rows by that much; to the gram, which the report shows, all
    balance.
- **Across reports:**
  - received ₱194,358.89 (ledger) = Procurement received
  - used ₱210,648.44 (ledger) = production cost
  - produced ₱209,361.40 and written off ₱12,619.88 = Production Summary / Waste
- **Roles, over HTTP:**
  - procurement → waste 403; production → procurement 403; viewer → procurement 200
  - Cubao's manager: own branch 200, Makati 403, waste 403
  - a manager of no branch: 403 with the message, and the page shows it
  - procurement with a branch: 400
  - each role's Reports list as above
- **Exports:** PDF and Excel for all three, landscape, 2–4 pages, each under a second. No unsupported characters in
  the PDF (routes print "Main Commissary -> Cubao Outlet").
- `tsc` and `eslint` are clean.

## Risks and follow-up

- **Raw materials have no stock value.** If management wants one (FIFO or average cost), that's a costing decision of
  its own, not part of this report.
- **The Procurement report counts decisions, not documents.** A purchase request rejected, then raised again and
  approved, counts once in each column.
- **A document approved late moves stock on the day it's approved**, so a past period can still change, as every
  note says.
