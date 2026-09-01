# 2026-09-01 — Roadmap page, progress tracking, and an invisible-input fix

Two small changes made after Week 2 closed.

## 1. The 12-week plan is now a running page at `/roadmap`

`kitchenERP-sprint-v3.jsx` was a standalone artifact nothing imported. It now renders in the app.

**How it's wired:** `app/roadmap/page.tsx` carries the `'use client'` directive and imports the
plan component. Everything imported from a client module joins the client bundle, so the boundary
is declared in the wrapper and the plan file itself needs no directive — it stays a hand-maintained
planning document rather than becoming app source.

**Why it sits outside `(protected)`:** the component paints its own full-viewport dark canvas
(`minHeight: 100vh`), which would look wrong inside the light sidebar shell and its `p-6` padding.
It is still behind auth — middleware requires a token on every path not in `PUBLIC_PATHS`, and no
`ROLE_GUARDS` entry matches `/roadmap`, so every signed-in role can read it. Verified: anonymous
gets `307 → /login`, VIEWER gets `200`.

A **Roadmap** link was added to `lib/navigation.ts` under Overview, visible to all roles.

### Progress tracking

Weeks carry a `status` (`"done"` / `"next"`), and tasks are now **either** a plain string **or**
`{ t, done: true }` / `{ t, partial: "why" }`. `readTask()` normalises both at render, which is why
Weeks 3–12 needed no edits and the existing `startsWith("FEATURE")` / `startsWith("COSTING")`
styling still works — it reads normalised text instead of assuming a string.

Counts are **derived** from those fields (`DONE_COUNT`, `phaseProgress`, `taskCounts`) rather than
stored. A stored count is a second source of truth that drifts the moment someone updates one and
not the other. Marking a week done is a one-line edit; the bar, phase counters and badges follow.

Current state: 2/12 weeks done, and the honest per-task picture is Week 1 at 4 done / 3 partial,
Week 2 at 4 done / 2 partial. The partials are recorded inline with the reason, notably:

- **No Accounting Approver role.** Week 1 called for it; the enum shipped as `ADMIN /
  PROCUREMENT_MANAGER / PRODUCTION_MANAGER / BRANCH_MANAGER / VIEWER`. This blocks Week 3's
  approval flow.
- **Dinuguan has 11 ingredients, not the 18** the plan and its deliverable text call for.
- **No Wet/Dry category split**; categories are Meat & Offal / Produce / Seasonings / Cooked Dishes.
- **Costing and AI tables don't exist yet** (22 of a planned 26).
- **Seeded materials were invented for testing**, not taken from Lydia's list.

## 2. Typed text was invisible in every input

**Symptom:** typing into any form field showed white text on a white background. Reported on
`/admin/master?tab=categories`, but it affected all 22 inputs and selects, including login.

**Cause:** `app/globals.css` still carried the stock create-next-app block:

```css
@media (prefers-color-scheme: dark) { :root { --foreground: #ededed; } }
```

With the OS in dark mode, `body { color: var(--foreground) }` made *inherited* text near-white.
Almost every element in this app sets an explicit `text-*` class, so the only things that inherited
were form controls — and they sit on white surfaces.

**Fix:**

1. Removed the dark-mode override and added `color-scheme: light` to `:root`. The app is a
   hard-coded light design, so the media query could only ever produce this class of bug.
   `color-scheme` additionally stops the browser rendering *native* control chrome in its dark
   theme — the date picker in the price-history form, every `<select>` arrow, scrollbars.
2. Added explicit `bg-white text-gray-900 placeholder:text-gray-400` to the shared `inputClass`
   plus the two one-off inputs (`login/page.tsx`, `BomScaleControl.tsx`). A control that inherits
   its colour is fragile regardless of theme.

## Files affected

| File | Change |
|---|---|
| `app/roadmap/page.tsx` | **New** — client wrapper rendering the plan |
| `kitchenERP-sprint-v3.jsx` | Week `status`, per-task state, derived counters, progress bar |
| `lib/navigation.ts` | Roadmap nav link |
| `app/globals.css` | Removed dark-mode override; added `color-scheme: light` |
| `components/ui/form.tsx` | Explicit colours on `inputClass` |
| `components/bom/BomScaleControl.tsx`, `app/login/page.tsx` | Same, for one-off inputs |

## Database / API changes

None.

## How to verify

```bash
npm run dev     # http://localhost:3000/roadmap
```

- Roadmap shows "2 / 12 weeks complete", phase counters `2/4 · 0/4 · 0/4`, ✓ on Weeks 1–2, → on Week 3.
- Week 1 detail reads "Tasks (7) · 4 done · 3 partial" with amber notes under each partial.
- `/admin/master?tab=categories` → **New category** → typed text is dark and readable.
- Test with the OS in **dark mode** — that's the only condition that reproduced the original bug.

## Risks, assumptions, follow-up

- **Progress is hand-maintained.** Nothing reads the database. Finishing Week 3 means changing its
  `status` to `"done"` and marking Week 4 `"next"`.
- **Light-only is now explicit.** Real dark mode would mean a dark variant for every hard-coded
  `bg-white` / `text-gray-800` surface, not just restoring two CSS variables.
- **Follow-up:** close two Week 2 partials cheaply — seed Dinuguan to 18 ingredients, and add the
  `ACCOUNTING` role (which Week 3 needs regardless).
