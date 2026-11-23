# 2026-11-24 — Sidebar search and collapse

Owner request, 2026-11-24: "make the sidebar search and collapsable". Part of Week 12 polish, but not a roadmap item
of its own.

## In plain words

- **Search the menu:** a box at the top of the sidebar filters the pages as you type.
  - It matches page names, section names and common abbreviations: PR, PO, RR, BOM, WO, TRF, "waste", "forecast",
    "suppliers"…
  - **Enter** opens the best match, which has a thin outline. **Esc** clears the box.
  - Press **/** anywhere (outside a text field) to jump to the box.
- **Collapse:** **Collapse** at the bottom shrinks the sidebar to icons only. Hover an icon for its name. The search
  icon reopens the sidebar with the box ready.
- **Your choice is remembered** in a cookie, and the server reads it, so the sidebar is the right width as soon as
  the page shows, without flashing open.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| S1 | **Collapse the whole sidebar to icons**, not individual sections | The common pattern; gives the page the most room |
| S2 | **Remembered in a cookie (`sidebar`), read by the protected layout** | localStorage is read only after the page shows, so the sidebar would flash open on every load |
| S3 | **`keywords` on the navigation items, and ranked matches** (exact abbreviation → name starts with → a word starts with → …) | "pr" opens Purchase Requests, not Approvals (which only contains "pr") |
| S4 | **Search shows only pages your role can open** | Same filter as before |

## What changed

- `components/dashboard/Sidebar.tsx`: search box, collapse toggle, icon-only mode, the `/` shortcut.
- `lib/navigation.ts`: `keywords` on items, `SIDEBAR_COOKIE`, `matchScore()`.
- `app/(protected)/layout.tsx`: reads the cookie and passes `initialCollapsed`.
- **Database, API, configuration:** none.

## How to test

1. **Search:**
   - Type `pr`: the list narrows to the matching pages, and Purchase Requests has a thin outline. Press **Enter** and
     Purchase Requests opens.
   - Try `bom`, `waste`, `forecast` and `supplier`.
   - Type `xyz`: "No page matches "xyz"". **Esc** clears it.
2. **Shortcut:** click on an empty part of a page, then press **/**. The cursor jumps to the search box.
3. **Collapse:**
   - Click **Collapse** (bottom of the sidebar). It shrinks to icons, and hovering an icon shows its name.
   - Press **F5**: it stays collapsed, with no flash.
   - Click the search icon: it opens again with the cursor in the box.
   - The expand button (bottom) opens it without search.
4. **Roles:** as `production@kitchen.com`, search `email`. Nothing matches, because Email is admin-only.

What I checked:
- **The page as the server sends it:**
  - no cookie or `sidebar=expanded`: full width with the search box and names
  - `sidebar=collapsed`: the narrow strip, with the search icon and no names
- **Matching against the real menu:**
  - Enter opens Purchase Requests for "pr", Purchase Orders for "po", Receiving for "rr", Bill of Materials for
    "bom", Write-offs for "waste", Plan for "forecast", End of Day for "end", and nothing for "xyz"
  - "bom" for a branch manager finds nothing (no access)
- `tsc` and `eslint` are clean.

## Risks and follow-up

- **New menu items** should get `keywords` if people know them by another name.
- **Already there before this change:** the **Users** item (admin) links to `/admin/users`, which has no page, so it
  shows "Page not found". Hide it, or build the page, in a later task.
- **Phones:** the sidebar still has no mobile layout. That belongs to the PWA task.
