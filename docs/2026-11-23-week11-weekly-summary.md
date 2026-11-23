# 2026-11-23 — Weekly management summary and "Email this report" (Week 11, Task 7)

This is the last Week 11 task. It covers the roadmap item "Report scheduler: auto-email weekly summary to management
every Monday" and the second half of the week's deliverable: "Generate and email a full week production report as
PDF".

## In plain words

- **Every Monday at 07:00**, admin and accounting get **last week's summary** (Monday to Sunday) in the bell and by
  email, with the PDF attached. It's a few pages:
  - production cost, batches and over plan
  - waste and goods lost in transit
  - what was ordered and received from suppliers, and what came short
  - finished goods at week end
  - what's waiting for approval
  - tables by kitchen, product, branch and supplier
  - **KitchenAI's waste findings**: its 06:00 report runs first, so the summary can include them
- **Reports → Weekly Management Summary** shows the same thing on screen, for any week.
- **"Email PDF" on every report page:** sends the report you're looking at as a PDF, **to me** or, for admin and
  accounting, **to management**. So "a full week production report as PDF" is: Reports → Production Summary → Last
  week → Email PDF.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| W1 | **The summary is a report in the engine** (`weekly-summary`, management only). It runs the Production Summary, Waste, Procurement and Inventory Movement builders for the same week and takes their figures and tables unchanged, by name. A renamed one fails loudly instead of quietly disappearing | No second calculation; the summary always agrees with the full reports |
| W2 | **Mondays 07:00, last Monday–Sunday, to every ADMIN and ACCOUNTING user** (owner, 2026-11-23) | After the 06:00 KitchenAI waste report, so its findings can be included |
| W3 | **One notification per person per week, emailed with the PDF.** The bell text's figures come from the same report. Nothing goes out for a week with no production, no purchasing and no waste | The bell, the email and the PDF agree; no empty Monday emails |
| W4 | **KitchenAI's findings are included when that report has been written**, and the section says so when it hasn't. It covers the 30 days to the week's Sunday (its own window), and the section says that too | The AI report runs at 06:00; the summary never waits on Claude |
| W5 | **"Email PDF": to me (anyone who can open the report), or to management (ADMIN / ACCOUNTING only).** It runs the report as the person asking, then queues one email per recipient with the period and branch fixed | What arrives is exactly what was on screen. A branch manager can't email another branch's report; the queue gives retries and the rate limit |
| W6 | **Attachments generalised to `{ report, query }`.** The worker builds any report's PDF when it sends; Resend's idempotency key is the job id | One path for the end-of-day snapshot, the Monday summary and "Email PDF" |

## What changed

- **New:**
  - `services/weekly-summary-report.service.ts`
  - `app/api/reports/[key]/email/route.ts`
  - `components/reports/EmailReportButton.tsx`
- **`services/report.service.ts`:**
  - the `weekly-summary` key
  - `ReportService.email()`
  - `branchId` on every `ReportDto`
- **`services/notification.service.ts`:**
  - new `notifyWeeklySummary()`
  - `WEEKLY_SUMMARY` is emailed
  - the `WeeklySummary` link
  - `attachmentFor()` returns `{ report, query }`
- **`services/email.service.ts`:** `sendReport()`, plus a shared `reportPdf()` helper.
- **`lib/queue.ts`:**
  - `WEEKLY_SUMMARY` in `DAILY_JOBS` (`0 7 * * 1`)
  - `REPORT_EMAIL`, `ReportEmailJob`, `ReportAttachment`
- **`worker/index.ts`:** handlers for both.
- **`app/(protected)/reports/[key]/page.tsx`:** the Email PDF button.
- **Roadmap:** Week 11 done, Week 12 next. progress.md: Week 11 complete.
- **Database:** none. **Config:** none.

## How to test

**First, restart both `npm run dev` and `npm run worker`** (Ctrl+C, then start again):
- The dev server lost the report route when I switched branches (`/api/reports/…` answers 404 until restarted).
- `tsx watch` didn't reload the worker after my edits, so it doesn't know the new jobs or the Monday schedule yet. On
  start it should print `weekly-summary scheduled "0 7 * * 1"`.

Then:
1. **The summary on screen:** as `accounting@kitchen.com`, Reports → **Weekly Management Summary** (last week).
   - Production cost ₱210,648.44, written off ₱12,619.88, ordered ₱200,345.73, received ₱194,358.89, the same as the
     full reports.
   - The KitchenAI section says it hasn't been written yet for these 30 days.
2. **The deliverable:** Reports → **Production Summary** → Last week → **Email PDF** → **To me**. "Sending to 1
   person". The email arrives with `production-summary_2026-11-16_2026-11-22.pdf`.
3. **To management:** Weekly Management Summary → Email PDF → **To management**. "Sending to 2 people. No email
   address for …" (the history accountant). Two emails arrive.
4. **The Monday job, now:** run `npm run job -- weekly-summary`.
   - The bell shows "Weekly summary, Mon, Nov 16 – Sun, Nov 22, 2026: production ₱210,648.44, written off
     ₱12,619.88", and an email arrives with the PDF.
   - Run it again: nothing new (once per week).
5. **As `production@kitchen.com`:** Email PDF shows only "To me"; the Weekly Management Summary isn't in their list.

What I verified before the restart (from a fresh process):
- The summary for last week builds in 133 ms. Its figures equal the four reports'. A production manager gets 403.
- The KitchenAI section reports "not written yet" instead of failing.
- `tsc` and `eslint` are clean.

After your restart (20:05), over HTTP and through your worker:
- **The summary:** JSON 200 with the same figures; PDF 200, 2 landscape pages. Redis holds the Monday schedule
  (`weekly-summary`, `0 7 * * 1`, Asia/Manila).
- **Email PDF:**
  - accounting → Production Summary, last week, to me: 202, 1 queued, SENT with its PDF.
  - accounting → Weekly Summary to management: 202, 2 queued (admin, accounting), "No email address for Carmen
    Reyes" (the history accountant); both SENT.
  - production → management: 403. production → Weekly Summary: 403 (can't open it). A bad `recipients`: 400.
- **`npm run job -- weekly-summary`:** 3 notifications ("Weekly summary, Mon, Nov 16 – Sun, Nov 22, 2026: production
  ₱210,648.44, written off ₱12,619.88") and 2 emails SENT with the PDF. The bell link opens
  `/reports/weekly-summary?from=2026-11-16&to=2026-11-22`. Run again: still 3, nothing new.

## Risks and follow-up

- **The summary runs four reports and reads the AI waste report**, about 1–2 s. That's fine for a Monday job and on
  request.
- **If a source report's figure or table is renamed**, the summary throws (W1). The Monday job then fails visibly in
  the worker log instead of sending a summary with a hole in it.
- **Management without a notification address** get the bell only. The history accountant is one such account.
