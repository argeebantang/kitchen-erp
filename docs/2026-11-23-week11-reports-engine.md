# 2026-11-23 — Reports engine, Production Summary and Cost per Batch (Week 11, Task 4)

This is the first half of the roadmap item "5 reports with CSV + PDF export: Inventory Movement, Production Summary,
Procurement, Waste & Write-off, Cost per Batch". The item now reads "Excel + PDF" (R9). It builds the engine every report shares, and the two production
reports the Week 11 deliverable needs ("Generate and email a full week production report as PDF"). The emailing comes
in Task 7.

What it gives:
- **Reports** in the sidebar (new group). It lists the reports the role may open.
- **A report page** (`/reports/production-summary`, `/reports/cost-per-batch`):
  - headline figures and tables
  - a filter bar: Period (Last week by default, This week, Last month, This month, or Custom dates up to 92 days
    ending today at the latest) and Kitchen (All or one)
  - **Download Excel** and **Open PDF** for exactly what's on screen
  - the filters live in the URL, so a report can be bookmarked or shared
- **Production Summary:**
  - Headline figures: production cost, batches signed off, batch cost, over plan, conversions, what conversions
    added, and runs awaiting sign-off.
  - Tables: by product (made, cost, cost per unit); by kitchen and by day (batches, batch cost, over plan,
    conversions, production cost, with totals); and the orders planned for the period by where they stand now.
- **Cost per Batch:**
  - Headline figures: batches, planned cost, actual cost, over plan, conversions.
  - Every signed-off run: order, date, kitchen, product, planned vs made, yield %, planned and actual cost, cost per
    unit, over plan, with a total.
  - Every approved conversion: what it was made from, source cost, what was added, total cost, cost per unit.
- **Excel (.xlsx), the formatted download:**
  - A **Summary** sheet: title, period, kitchen, generated time, the figures with notes, and the notes.
  - **One sheet per table**, each with a bold shaded frozen header, filter buttons, sized columns and a bold total
    row.
  - Values are real Excel numbers and dates, so they sort, filter and sum: money as `₱#,##0.00` (negatives in red),
    quantities to the gram, yield as %, days as "Mon, Nov 16, 2026".
  - **Alignment** (owner, 2026-11-23). Money and quantities are right-aligned so decimal points line up; counts,
    yield and dates are centred; names are left-aligned. Each header aligns with its column.
- **PDF:** the same content, on A4. Landscape when a table has 8 or more columns. Page numbers, period and kitchen
  in the footer. Money as "PHP 1,234.50".

## Decisions

| # | Decision | Rationale |
|---|---|---|
| R1 | **One engine.** A report returns one `ReportDto` (figures and tables of plain values, each column with a kind), and the page, Excel and PDF all render that DTO | The three formats cannot disagree, and Tasks 5–7 add reports without new renderers |
| R2 | **No second calculation.** The builders only arrange `CostingService.productionDetail`, which shares one internal calculation (`periodFigures`) with `productionCosts`, the assistant's figures | The owner's rule. I ran the old and new `productionCosts` side by side on three periods, and the JSON was identical. Last week's figures also match the Costing dashboard |
| R3 | **Generated on request, never stored** (owner, 2026-11-23) | Figures are as they stand when asked for. A sign-off that arrives late changes a past period, as on the Costing dashboard, and the notes say so. Archiving PDFs can come with S3 in Week 12 |
| R4 | **Periods:** the four presets, or custom dates of at most 92 days, ending today at the latest. Weeks run Monday–Sunday in Manila; the default is last week (owner, 2026-11-23) | The weekly report is the main use. 92 days covers a quarter, and a 92-day PDF with all kitchens is 19 pages, rendered in about 7 s |
| R5 | **Roles:** both reports for ADMIN, ACCOUNTING, VIEWER and PRODUCTION_MANAGER (owner, 2026-11-23). The route guard admits those roles; `ReportService` checks each report's own list | Tasks 5–6 add reports for procurement and branch managers by widening the guard, not by new rules |
| R6 | **Totals are the exact sum rounded once.** Each report says rows are rounded to the centavo and may differ from the total by a few centavos | Last week's per-day rows add up to ₱210,648.46 against a true total of ₱210,648.44. Forcing rows to match would misstate them |
| R7 | **Kitchen filter on these two.** It lists active kitchens and accepts an inactive one by id | Only kitchens cook. A past period may include a kitchen closed since |
| R9 | **Excel instead of CSV** (owner, 2026-11-23). A CSV was built first; opened in Excel it was unaligned and unformatted ("csv report is ugly"), and the owner chose Excel and asked for CSV and all its code to be removed. Uses the new dependency `exceljs` ^4.4.0. The roadmap item now reads "Excel + PDF" | A CSV can't carry alignment, bold, widths or number formats, and Excel drops trailing zeros ("209361.4"). Its only advantage, importing into other tools, isn't needed now; it could come back as a separate export later. `npm audit` flags exceljs as moderate only through `uuid`'s v3/v5/v6 buffer check; exceljs only calls `uuid.v4()` without a buffer, so it can't be reached |
| R8 | **Thousands separators in reports** (`lib/report-format.ts`), on top of `formatPeso` / `formatQuantity`'s exact rounding. App-wide formatting is unchanged | Report totals run into the millions. Changing `formatPeso` everywhere wasn't part of this task |

## What changed

- **Repositories:**
  - `production-order.repository.ts`: `findCompletedProducedBetween` takes an optional kitchen and also returns the
    planned quantity, planned cost and branch id. `countAwaitingCompletionBetween` takes an optional kitchen. New
    `countByStatusPlannedBetween`.
  - `conversion-order.repository.ts`: `findApprovedProducedBetween` takes an optional kitchen and returns the order
    number, source, quantities, cost per unit and branch.
- **`services/costing.service.ts`:**
  - `periodFigures()` is the one calculation.
  - `productionCosts()` is unchanged in output and now built on it.
  - New `productionDetail()` returns every run and conversion, the totals per kitchen and per day, the summed
    planned cost, and orders by status.
  - New DTOs: `PeriodRunDto`, `PeriodConversionDto`, `PeriodGroupDto`, `ProductionDetailDto`.
- **New:**
  - `services/report.service.ts`: types, registry, presets, period checks, `list` / `options` / `run`
  - `services/production-report.service.ts`: the two builders
  - `lib/report-format.ts` (also `reportFileName`), `lib/xlsx.ts`
  - `components/pdf/ReportDocument.tsx`, `components/reports/ReportView.tsx`, `components/reports/ReportFilters.tsx`
  - `app/(protected)/reports/page.tsx`, `app/(protected)/reports/[key]/page.tsx`
  - `app/api/reports/[key]/route.tsx`
- `middleware.ts`: `/reports` and `/api/reports` for ADMIN, ACCOUNTING, VIEWER and PRODUCTION_MANAGER.
  `lib/navigation.ts`: the Reports group.
- **Dependency:** `exceljs` ^4.4.0 (`package.json`, `package-lock.json`).
- **Database:** none. **Config:** none.
- **API:** `GET /api/reports/[key]` (see api.md).

## How to test

No restart is needed; nothing in the database changed. The history data (90 days, 6 branches) is the test data, and
no new records were created for this task.

1. As `accounting@kitchen.com`: Reports → **Production Summary**. It opens on "Mon, Nov 16 – Sun, Nov 22, 2026 ·
   All kitchens":
   - Production cost ₱210,648.44, 41 batches, batch cost ₱209,361.40, over plan ₱7,877.44, 4 conversions, ₱1,287.04
     added.
   - Costing (sidebar) → last week shows the same batch and conversion amounts.
2. By kitchen: Las Piñas, Main and Pasig, with totals equal to the headline. By day: seven rows.
3. Kitchen → Main Commissary → Show. The URL gains `&branch=…`, and the figures drop to Main's 15 batches.
4. **Download Excel** and open it:
   - a Summary sheet, then By product, By kitchen, By day and Orders planned for the period
   - ₱ amounts with separators, bold totals, filter arrows on the headers, days as "Mon, Nov 16, 2026"

   **Open PDF** gives a titled report with page numbers.
5. Period → Custom dates: try 2026-08-01 to 2026-11-23 ("at most 92 days"), then 2026-11-20 to 2026-11-10 ("start
   date is after the end date").
6. **Cost per Batch**, Last month, All kitchens → Open PDF: a landscape table of every run, with totals.
7. As `production@kitchen.com` and `viewer@kitchen.com`: both reports open. As `procurement@kitchen.com`: no Reports
   in the sidebar, and `/reports` → Unauthorized.

What I verified:
- **The old `productionCosts` from git against the new one**, for the 90 days, last week and today: identical JSON.
  `productionDetail`: 41 of 41 runs; kitchens add up to ₱210,648.44 exactly; the days add up to ₱210,648.46
  (rounding, hence R6).
- **The Costing dashboard's last week:** 41 batches, ₱209,361.40, ₱1,287.04 added. Same as the report.
- **Over HTTP:**
  - The JSON's figures and tables, with totals equal to the headline.
  - Cost per Batch for Main as a PDF, read back from its text: landscape A4, 2 pages, every column, negatives as
    "PHP -5.72".
  - The full 92-day, all-kitchen PDF: 19 pages in 6.8 s.
  - The Excel workbook, read back cell by cell: Summary plus 4 sheets, values as numbers / dates with the right
    formats, frozen header, filters, bold totals equal to the headline. The 92-day Cost per Batch workbook is 46 KB
    in 1.5 s.
- **Refusals:** start after end, 93 days, ending tomorrow, 30 February, one date only, an outlet as the kitchen
  (each 400 with its reason), unknown report (404), a bad format (400). Procurement → /unauthorized for the page and
  the API. Viewer and production open both pages.
- `tsc` and `eslint` are clean.

## Risks and follow-up

- **PDF rendering is synchronous** (about 7 s for 19 pages in dev). That's fine on request. Task 7 generates the
  emailed PDF in the worker.
- **The PDF table header doesn't repeat on each page.** Rows never split, and each page carries the report and
  period in the footer.
- **Planned cost equals actual cost in the history data.** A run is costed at its recipe's planned quantities, and
  history plans and cooks on the same day's prices, so "over plan" there comes entirely from yield. That's
  correct, not a bug.
