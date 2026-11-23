# 2026-11-24 — Paging, search and sort on every list

Owner request, 2026-11-24: "table is not server side. no pagination" and "add also a search and sort in table".

## In plain words

- **Every list now pages:** "Showing 51–100 of 250 requests", then **‹ Prev 1 2 3 … 5 Next ›**.
  - Seven lists had no paging and silently stopped at 100 rows: Purchase Requests, Purchase Orders, Receiving, Stock
    Requests, BOMs, and Master Data → Materials and Finished Goods. With the history data loaded, about 150 purchase
    requests couldn't be reached.
  - The seven lists that had Newer / Older now use the same bar.
- **A search box** on every list. It searches **all** rows, not just the page shown: document numbers, names,
  branches, suppliers, and the materials or goods on a document. Results update as you type, and **Esc** clears the
  box.
- **Click a column header to sort.** Click again to reverse. An arrow shows the column and direction.
- **It all stays in the address bar** (`?page=3&q=pork&sort=number&dir=asc`). Filters, search and sort survive
  paging, a link can be shared or bookmarked, and **Back** works.
- **The server does the work.** Each page asks the database for its 50 rows and a count; the browser never receives
  the whole table.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| L1 | **Paging, search and sort in the database, driven by the URL** | Lists stay fast as they grow; a search covers every row; views can be linked to |
| L2 | **One shared set of controls:** `Pagination`, `SortHeader`, `SearchBox`, `ListEmptyState`, `KeepListParams`; one parser, `parseListQuery` | Every list behaves the same way |
| L3 | **Only columns the database can order by are sortable.** Line counts, estimated totals and "Goods" are computed per row | Sorting them would mean loading every row |
| L4 | **Default orders are the old ones:** number newest first; Transfers, Conversions and Write-offs by Recorded (deliveries and returns stay interleaved); Stock Requests by Needed, soonest first; Sales by Sold on | Nothing reorders unless you click a column |
| L5 | **The Ledger pages but doesn't sort or search; BOMs search and page but keep one order** | The Ledger's running balance needs date order; BOMs are cards with no column headers |
| L6 | **Search as you type** (after 0.35 s), replacing the URL rather than adding history | Each keystroke isn't a Back step |
| L7 | **No new index for search** | About 0.1–0.2 s at current volumes. If a list reaches tens of thousands of rows, add a `pg_trgm` index (database.md) |

## What changed

- **New:**
  - `lib/list-query.ts`: `parseListQuery`, `listHref`, `containsText`, `PAGE_SIZE`
  - `components/ui/ListControls.tsx`
  - `components/ui/SearchBox.tsx`
- **Repositories** (`search` + `listSort` on `findMany`, plus `*_SORT_KEYS`): purchase-request, purchase-order,
  receiving-report, production-order, conversion-order, write-off, stock-transfer, stock-request, outlet-sale, bom,
  material, finished-good.
- **Services:** re-export the sort keys. Stock Requests and Transfers pass search, sort and paging through. Daily Sales
  takes the list query instead of a page number (`SALES_PAGE_SIZE` removed).
- **Pages:**
  - Procurement: requests, orders, receiving
  - Production: orders, conversions, BOMs
  - Inventory: write-offs, transfers, requests, sales, ledger
  - Admin: AI questions, Master Data
- **Panels:** `MaterialsPanel`, `FinishedGoodsPanel` take a `list` prop and draw the search box and sortable headers.
- **Docs:** architecture.md (List pages), coding-conventions.md, database.md (search and indexes), overview.md,
  progress.md, roadmap.
- **Database, API, configuration:** none.

## How to test

The 90-day history data is loaded (`npm run seed:history`), so the lists are long.

1. **Paging:** Purchase Requests shows "Showing 1–50 of 250 requests". Click **5**, then **‹ Prev**. Page 5 ends at
   PR-000001.
2. **Sort:** click **Number**, which turns oldest first (PR-000001 on top) with an up arrow. Click again for newest
   first. Try **Requested by** and **Needed by**.
3. **Search:**
   - Type `pork` and wait a moment: 88 requests, from every page.
   - Type `PR-00012`: the 10 matching numbers.
   - Type `zzz`: "No requests match "zzz"", with **Clear the search**.
   - **Esc** clears the box.
4. **Everything together:** Production Orders → Status **Completed** → Apply. Then search `lechon`, sort by
   **Production date**, and go to page 2. The address bar holds all of it. Press **Back** to step through.
5. **Filters keep the search:** on Transfers, search `main`, then change Status and click **Apply**. The search is
   still there.
6. **Master Data → Materials:** search `pork` (5 materials), and sort by **Code** or **Reorder point**.
7. **Roles:** as `production@kitchen.com`, Purchase Requests shows only your own request.

What I checked:
- **Every list over HTTP:** paging, each sort, search, search with sort and page together, filters with search, and
  unknown values (`?sort=bogus&page=abc` falls back to the default).
- **Search counts match the database:** "pork" finds 88 purchase requests and 5 materials, the same as direct SQL
  counts.
- **Speed:** 0.1–0.3 s per page once compiled.
- **Roles:** all lists as admin, production manager and branch manager. Pages a role can't open still redirect; scoped
  lists show only that role's rows; a page past the end says so.
- `tsc` and `eslint` are clean.

## Risks and follow-up

- **This branch is stacked on `week12/sidebar-search-collapse`.** Merge that PR first.
- **Sorting by Status follows the database's status order** (draft → pending → approved…), not alphabetical order.
- **The Approvals inbox isn't paged** (decided earlier): it's a work queue, capped at 100 per document type.
- **Test data:** the history data is loaded for this test. `npm run seed:history -- --clean` removes it at clean-up.
