# 2026-11-23 — End-of-day branch snapshot (Week 11, Task 6)

Covers the roadmap item "End-of-day branch snapshot report".

## In plain words

Every evening, each branch's day on one page: what finished goods it started with, made, sold, threw away and sent
or received, what's left and what it's worth; the raw materials it received and used; every document that moved
stock; and what's still waiting for approval there.

- **On screen:** Reports → **End-of-Day Snapshot**. Pick the day (Today, Yesterday or a date) and a branch, or all.
  Download it as Excel or PDF.
- **By email at 21:00**, with no one having to open anything:
  - **Management** (admin, accounting, production) already get the end-of-day email. It now has the **all-branches
    snapshot attached as a PDF**.
  - **Each branch manager** now gets their own end-of-day notification and email, with **their branch's snapshot
    PDF**, on days their branch moved stock. Branch managers got nothing in the evening before.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| E1 | **A report in the engine**, for one day (`span: 'day'`: a date, or Today / Yesterday, never after today) | Page, Excel and PDF come free, and the PDF emailed is the same report anyone can open |
| E2 | **Every figure is another page's:** End of Day (finished goods and the day's documents), the Stock Ledger (raw materials for the day), the approvals inbox (what waits). The snapshot only picks the branch's rows | The owner's rule; the snapshot can't disagree with End of Day |
| E3 | **Management's PDF rides on the end-of-day email they already get**, so it's one email, not two. **Branch managers get a new `END_OF_DAY_BRANCH`**, worded like the summary (one shared helper), only for a branch that moved finished goods that day, once per manager per branch per day | Owner, 2026-11-23 (accepted plan). No empty evening emails |
| E4 | **The PDF is built by the email worker when it sends, never stored.** The job only names it. A failure retries like a busy Resend, then logs FAILED; an email never goes without its PDF | Small jobs; figures as they stand at sending; R3 (nothing stored) |
| E5 | **"Waiting for approval" is as of now**, not at the close; the figure says so | The inbox holds only what waits now. History of waiting isn't kept |
| E6 | **PDF rendering moved to `lib/report-pdf.ts`**, which loads `@react-pdf/renderer` with `import()`. `ReportDocument` takes the library as an argument and uses the automatic JSX runtime (a file pragma) | The worker runs under tsx as CommonJS. There, a `require()` of the ESM-only renderer fails (ERR_PACKAGE_PATH_NOT_EXPORTED), which would have **stopped the worker at startup**. Found while testing. The report route uses the same path and produces byte-identical PDFs |

## What changed

- **New:**
  - `services/end-of-day-report.service.ts`: the snapshot.
  - `lib/report-pdf.ts`: the one PDF renderer, replacing the route's own.
- **`services/report.service.ts`:** the `end-of-day` key and a one-day mode: `span`, `DAY_PRESETS`, `resolveDay`,
  `singleDay` in the filter options, and `date` in the query.
- **`components/pdf/ReportDocument.tsx`:** `reportDocument(pdf, report)` takes the library as an argument (a
  type-only import plus the JSX pragma).
- **`services/notification.service.ts`:**
  - `endOfDayMessage()` holds the summary wording, moved out unchanged.
  - New `notifyBranchEndOfDay()`.
  - `END_OF_DAY_BRANCH` is emailed.
  - `attachmentFor()` picks which snapshot each end-of-day email carries.
  - New link: `EndOfDayBranch` → the snapshot for that day and branch.
- **`services/email.service.ts`:** `sendNotification` generates and attaches the named PDF.
- **`repositories/notification.repository.ts`:** `createMany` also returns `referenceId`.
- **`lib/queue.ts`:** `NotificationEmailJob.attachment`.
- **`worker/index.ts`:** the 21:00 job also runs `notifyBranchEndOfDay`, and the email job passes the attachment on.
- **UI:**
  - `components/reports/ReportFilters.tsx`: "Pick a date…" with one Date field for a one-day report.
  - `app/(protected)/reports/[key]/page.tsx` and `app/api/reports/[key]/route.ts` (no longer `.tsx`): the `date`
    parameter.
- **Database:** none. **Config:** none.

## How to test

**First, restart `npm run worker`.** It must be running this code at 21:00 tonight; `tsx watch` doesn't always notice
changes. No dev-server restart is needed.

1. **Your inbox.** I ran the 21:00 job for **yesterday (Sun, Nov 22)**, the last day with stock movement, so these
   are already there:
   - three emails "End of day, Sun, Nov 22: 45 movements — closing ₱33798.21 at cost" (to admin, accounting and
     production, all your address), each with **end-of-day_2026-11-22.pdf**
   - one "End of day at Cubao Outlet, Sun, Nov 22 …" with **end-of-day_cubao-outlet_2026-11-22.pdf**

   Open a PDF: one landscape page per section, every row "OK".
2. **On screen:** as `accounting@kitchen.com`, Reports → **End-of-Day Snapshot** → Day: Yesterday → Show. Then pick
   Branch → Main Commissary → Show. Download Excel.
3. **As a branch manager:** log in as `lorna.bautista@history.kitchen.com` (`password123`):
   - the bell has "End of day at Cubao Outlet …"
   - clicking it opens the snapshot for Cubao, with no other branch to choose

Tonight at 21:00 the real job runs for today. The history data has no movement today, so it will rightly send
nothing.

What I verified:
- **The snapshot over HTTP:**
  - Main, yesterday: produced ₱10,538, transferred out ₱14,194.33, raw used ₱10,538, every row OK.
  - All branches: 32 documents, 4 waiting for approval.
  - Today works; tomorrow → 400; Cubao's manager is held to Cubao; procurement → 403.
- **The worker renders PDFs under tsx.** First it failed (ERR_PACKAGE_PATH_NOT_EXPORTED, then "React is not
  defined"); E6 fixed both. The route and a tsx script produce the same 10,322-byte PDF, and the restarted worker
  stayed up.
- **The 21:00 steps for Nov 22, run against your worker:**
  - 5 summary notifications plus 3 branch-manager notifications.
  - 4 emails SENT, each with its PDF. SENT can't happen without the PDF: a failed PDF retries and ends FAILED.
  - Run again: nothing sent.
  - Cubao's PDF read back: sold ₱14,663.54; transferred in ₱14,194.33, equal to Main's out; every row OK.
  - Lorna's bell link opens the snapshot for Cubao.
- `tsc` and `eslint` are clean.

## Risks and follow-up

- **Report PDFs now go through `lib/report-pdf.ts`.** A new PDF document must take the library as an argument the
  same way, or the worker can't render it. The purchase-order PDF is only rendered by the app, so it's unaffected.
- **Branch managers without a notification address** get the bell only. All three in the history data are like
  that, except Cubao's, given one for this test (removed at "clean up").
- **Outlets show raw materials as ₱0.00**: they hold none.
