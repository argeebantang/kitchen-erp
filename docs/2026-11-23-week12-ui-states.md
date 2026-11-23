# 2026-11-23 — Loading, error and not-found screens everywhere (Week 12, Task 1)

First half of the roadmap item "UI polish: loading states, empty states, error states on every screen". The owner
moved polish to the front of Week 12 and deploying to the end (2026-11-23). This task does the app-wide part in one
go. Task 2 goes screen by screen: empty lists and form errors.

## In plain words

- **Loading:** click anything and the page area shows a grey placeholder (title, a table) until the page arrives.
  Before, the old page just sat there. Fast pages (under 0.15 s) don't flash it.
- **Sidebar clicks react at once:** the clicked item lights up with a small spinner until its page shows. In
  development nothing preloads, so a click used to look ignored until the server answered.
- **Errors:** if a page fails (for example, the database drops out), you get "Something went wrong loading this page"
  with **Try again**, **Go to Dashboard** and a reference code, instead of the Next.js crash page. When only the page
  fails, the sidebar stays.
- **Not found:**
  - An unknown address like `/foo` shows "Page not found" with a link to the dashboard.
  - A record that isn't available (a stock request, a sale, a BOM, a report) now shows "Not available" inside the
    app. Before, it showed the plain Next.js 404.
- **The browser tab** says "KitchenERP" instead of "Create Next App".

## Decisions

| # | Decision | Rationale |
|---|---|---|
| U1 | **A `loading.tsx` in every folder that has sub-pages (20), all the same skeleton.** Not one at the top | Next.js picks the loading file of the folder *above* the page that changes. A single top-level file only shows when you switch modules (Procurement → Inventory), not between pages in a module or from a list to a detail. For the same reason, the skeleton can't be shaped to the page being opened, so it's one generic shape |
| U2 | **The skeleton fades in after 150 ms** | No flicker on fast pages |
| U3 | **Three error screens:** protected pages (sidebar stays), the protected layout and public pages (full screen), the root layout (last resort, production only) | Each catches what the one below can't. A database outage on a full page load fails the layout, which reads the signed-in user |
| U4 | **Try again = refresh + reset; the error's reference code is shown, never its message** | Reset alone re-shows the failed result. The code matches the server log; the message can name tables or ids |
| U6 | **A spinner on the clicked sidebar link** (`useLinkStatus`, Next 15.3), added after the owner's test (2026-11-24) | The skeleton appears only once the server answers. In production, links preload it, so that's instant; in development nothing preloads, so the click looked ignored |
| U5 | **One `EmptyState` for "nothing here"; the 8 existing not-found pages use it, with the same wording** | One look; Task 2 uses it for empty lists |

## What changed

- **New:**
  - `components/ui/states.tsx`: `EmptyState`, `PageSkeleton`
  - `components/ui/ErrorState.tsx`
  - `app/(protected)/error.tsx`, `app/(protected)/not-found.tsx`
  - `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`
  - `loading.tsx` in 20 folders under `app/(protected)/`: the group itself, `admin`, `admin/ai`, `inventory` and its
    `branches`, `requests`, `sales`, `transfers`, `write-offs`, `procurement` and its `orders`, `receiving`,
    `receiving/[id]`, `requests`, `production` and its `bom`, `conversions`, `orders`, `orders/[id]`, `reports`
- **Changed:**
  - the 8 module `not-found.tsx` pages now use `EmptyState`, with the same text
  - `app/globals.css`: the `animate-appear` utility
  - `app/layout.tsx`: title and description
  - `components/dashboard/Sidebar.tsx`: `PendingSpinner` on every link
- **Docs:**
  - architecture.md: "Page states"
  - coding-conventions.md: three UI rules
  - overview.md, progress.md
  - roadmap: Week 12 reordered, UI polish partly done
- **Database, API, configuration:** none.

## How to test

`npm run dev` picks up the new files by itself. If something looks unchanged, restart it.

1. **Loading:**
   - Open DevTools (F12) → Network → change "No throttling" to **Slow 4G**.
   - Click around the sidebar, and from a list into a document (Purchase Requests → PR-000004).
   - Each time, a grey title-and-table placeholder appears while the page loads, and the sidebar stays.
   - Set throttling back to "No throttling" when you're done.
   - Without throttling: click a sidebar item. It lights up with a spinner straight away, until the page shows.
2. **Page not found:** go to `http://localhost:3000/foo`. You get "Page not found" and **Go to Dashboard**.
3. **Not available, inside the app:** go to `http://localhost:3000/reports/nope`. You get "Not available" with the
   sidebar. `/procurement/requests/nope` shows its own "Purchase request not available", as before.
4. **Error, sidebar stays:**
   - Open the dashboard. In a terminal: `docker compose stop postgres`.
   - Click **Purchase Requests** in the sidebar. You get "Something went wrong loading this page", the sidebar, and a
     reference code.
   - In development, Next.js also pops up its own red error overlay. Close it (Esc) to see the page underneath.
5. **Try again:** run `docker compose start postgres`, wait about 5 seconds, then click **Try again**. The list loads.
6. **Error, full screen:** stop Postgres again and press **F5**. The whole page is the error card (the layout itself
   couldn't load your user). Start Postgres, then click **Try again**.

What I checked over HTTP:
- `/foo` and `/procurement/xyz` answer 404 with "Page not found".
- `/reports/nope`, `/inventory/requests/nope`, `/production/bom/nope` and `/procurement/requests/nope` send the skeleton
  first, then Next's not-found signal. The browser shows the not-found card.
- Normal pages send the skeleton, then the page.
- With Postgres stopped, a page fails in 0.08 s (500). After starting it again, the same page answers 200.
- The tab title is KitchenERP. `tsc` and `eslint` are clean.

## Risks and follow-up

- **Pages that call `notFound()` now answer HTTP 200, not 404.** Streaming sends the 200 before the page decides it's
  missing. The screen is the same and Next marks it `noindex`. It doesn't matter for an internal app, and API routes
  and unknown URLs still return real 404s.
- **A new folder with sub-pages needs its own `loading.tsx`**, or navigating inside it shows nothing while loading.
  This is now a rule in coding-conventions.md.
- **Filters that change only the URL's `?…`** (Stock Levels, Ledger, reports) don't show the skeleton. Next.js keeps
  the old page until the new one is ready. Task 2 checks those screens.
