# 2026-11-24 — Empty states and form errors on every screen (Week 12, Task 2)

The second half of "UI polish: loading states, empty states, error states on every screen". Task 1 did the app-wide
loading, error and not-found screens. This task goes screen by screen. The owner approved a two-screen sample first
(Materials, Production Orders), then the sweep.

## In plain words

- **Forms never hang on "Saving…" any more.** If the connection drops or the server fails, the form says so in plain
  words and the button comes back. Seven places had no handling: Master Data (Materials, Finished Goods, Branches,
  Reference Data), sign-in, sign-out and the AI connection test.
- **A refusal is no longer taken for success.** When your role isn't allowed or your session has ended, the server
  used to redirect the request. Forms followed the redirect and thought it worked; for example, Deactivate looked like
  it had worked. Now the server answers "Your role cannot do this." or "Your session has ended. Sign in again.", and
  all 37 forms show it.
- **Validation errors name the field:** "Name: String must contain at least 2 character(s) · Reorder point: Must be a
  non-negative decimal" instead of "Validation failed".
- **Empty lists:**
  - **"No X yet"** comes with the next step, and a button only for roles that can take it (New Request, New
    transfer, Record Conversion…).
  - **A filter with no results** says "No X match these filters" with **Clear filters**.
  - About 35 places now share one look.
- **Tabs, chips and Newer / Older** show a small spinner while the page loads. Those clicks never show the page
  placeholder, so they used to look ignored.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| E1 | **The middleware answers API calls with JSON 401 / 403 instead of redirecting.** A download the browser opens itself (`Sec-Fetch-Mode: navigate`) and every page still redirect | One change fixes all 37 places that call the API. Downloads and pages keep showing the login or "unauthorized" page |
| E2 | **`requestJson` (`lib/http.ts`)** for browser requests. It never throws, gives one sentence per failure, and treats a redirect to `/login` or `/unauthorized` as 401 / 403 | A form always leaves its busy state. Moved to it: the 7 places with no error handling. The 30 that already caught errors keep their code (no churn) and get readable 401 / 403 from E1 |
| E3 | **Validation errors read "Field: rule · Field: rule"**, the format the Branches panel already used | The existing project pattern, now shared |
| E4 | **Empty because of a filter ≠ empty for real:** different message, Clear filters vs the next step | They need different actions |
| E5 | **Compact notes inside bigger pages stay as they are:** report tables, costing charts, transfer status boxes, the dashboard's assistant note, the schedule's month note | They're deliberately small and sit among other content |
| E6 | **`PendingSpinner` on links that change only the URL's `?…`:** Master Data tabs, holiday years, lot chips, costing ranges, calendar months, Newer / Older on 7 lists | These stay on the same page segment, so no skeleton ever shows |

Tables without an empty message that **can't be empty** stay as they are:
- a BOM's or sale's lines (at least one is required)
- the costing weeks (a fixed range)
- the AI features table (fixed list)

## What changed

- **New:**
  - `lib/http.ts` (`requestJson`, `errorMessage`)
  - `components/ui/PendingSpinner.tsx`, moved out of the Sidebar
- **`middleware.ts`:** `refuse()` returns JSON for API calls, a redirect for pages and downloads.
- **Forms on `requestJson`:**
  - `components/master/` MaterialsPanel, FinishedGoodsPanel, BranchesPanel, ReferenceDataPanel
  - `app/login/page.tsx`
  - `components/dashboard/` Topbar, NotificationBell
  - `components/ai/TestConnection.tsx`
  - `hooks/useNotifications.ts`: no unhandled error when offline
  - `components/ui/form.tsx`: `IconButton` takes `disabled`
- **`EmptyState`:**
  - **Procurement:** requests, orders, receiving (+ new, edit)
  - **Production:** orders (+ new, edit), conversions (+ new), BOMs, plan
  - **Inventory:** stock, finished goods, ledger, write-offs (+ new), transfers, requests, sales, branches (+ detail),
    end of day
  - **Admin:** AI questions
  - **Reports**
  - **Components:** ApprovalInbox, SuppliersPanel, StockRequestForm, OutletSaleForm, TransferOrderForm
- **`PendingSpinner`:**
  - MasterTabs, HolidaysPanel
  - finished-goods chips, costing ranges, schedule navigation
  - Newer / Older on write-offs, AI questions, ledger, production orders, transfers, conversions, sales
- **Docs:**
  - api.md: 401 / 403 for API calls
  - architecture.md: requests from the browser, empty states
  - coding-conventions.md: three rules
  - overview.md, progress.md
  - roadmap: UI polish done
- **Database, configuration:** none. **API:** refusals from the middleware are now JSON 401 / 403 for API calls (see
  E1).

## How to test

Sign in as `admin@kitchen.com`. To fake "no connection": F12 → Network → **Offline**.

1. **A form that used to hang:**
   - Master Data → Finished Goods → Edit (pencil). Switch to Offline, then click Save.
   - Expect "Could not reach the server…", and the button comes back.
   - Switch back to No throttling.
2. **Field errors:** in the same form, clear the Name, then click Save. Expect "Name: …".
3. **Role refusal (new).** Forms call the API from code, so test it from code:
   - Sign in as `production@kitchen.com`, then press F12 → **Console**.
   - Paste: `fetch('/api/materials/x', { method: 'DELETE' }).then(r => r.json()).then(console.log)`
   - You get `{error: 'Your role cannot do this.'}`. Before, it came back as the "unauthorized" HTML page with status
     200.
   - Sign out. On the login page's Console, paste: `fetch('/api/notifications').then(r => r.json()).then(console.log)`
   - You get `{error: 'Your session has ended. Sign in again.'}`.
4. **Downloads still redirect:** signed out, type `localhost:3000/api/reports/production-summary?format=pdf` in the
   address bar. You land on the login page.
5. **Empty and filtered lists:**
   - Inventory → **Transfers** → Status **Received** → Apply: "No transfers match these filters", then **Clear
     filters**.
   - **Write-offs:** "No write-offs yet" with **Open Finished Goods**.
   - **Finished Goods** → the **expired** chip: "No lots expired", then **Show every lot**.
6. **Spinners on tabs and paging:**
   - Master Data → click the tabs (Suppliers, Holidays…). A spinner appears next to the clicked tab until it loads.
   - Costing → click **8 weeks**: same.

What I checked:
- **The helper against your API:** each failure gives its sentence. An invalid form gives "Name: … · Reorder point:
  …"; an unknown material gives "Material not found"; the production manager gives 403 "Your role cannot do this.";
  signed out gives 401; and the server unreachable gives the network message.
- **The middleware over HTTP:**
  - API calls from code: 403 and 401 as JSON.
  - A navigated PDF download, signed out: 307 to /login.
  - A page the role can't open: 307 to /unauthorized.
  - Admin reads: 200.
- **All 32 touched pages** answer 200, as admin and as production manager. The right message shows for empty,
  filtered and unknown-filter cases (an unknown status value is ignored, as before). Buttons follow the role: no
  Record Conversion for roles that can't record.
- Nothing in the database changed. `tsc` and `eslint` are clean.

## Risks and follow-up

- **The 30 forms that already handled errors keep their own code.** They still show "Validation failed" for a 400
  without field names. Most validate before sending, so it's rare. Move one to `requestJson` when you next touch it.
- **Admin sees "Record sales"** on an empty Sales list but runs no outlet, so the form says "No outlet to record for".
  The header button already did the same before this task.
- **`ReferenceDataPanel` imports a value from `repositories/`** into a Client Component (`CATEGORY_TYPES`). That's
  against the conventions, but it was already there and is out of scope.
