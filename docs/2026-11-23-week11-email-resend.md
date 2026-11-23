# 2026-11-23 — Email notifications via Resend (Week 11, Task 2)

Covers the roadmap item "Email notifications via Resend, building on the in-app bell". It also fills a gap found
while planning the week: purchase orders and receiving reports told nobody they were waiting for approval, and
nobody heard when a purchase request, order or receiving report was decided.

What it gives:
- **Emails that copy the bell.** Each of these notifications is also emailed, with the same title and text and an
  "Open in KitchenERP" button to the same page:
  - something waiting for your decision
  - a decision on something you submitted
  - the 21:00 end-of-day summary
- **Only to a notification address.** Each user has a new `notificationEmail`, separate from their login. The seed
  accounts log in as `@kitchen.com` and the history staff as `@history.kitchen.com`. Those are real domains nobody
  here owns, so the login address is never emailed. With no notification address, a user gets the bell only.
- **Admin → Email** (new, ADMIN only):
  - whether Resend is set up, and the sender
  - "Send a test email to me"
  - the last 7 days' sent / skipped / failed counts
  - every user with an editable notification address
  - the latest 50 emails, each with its status and why it wasn't sent
- **Without a Resend key** nothing is sent. Each email is logged SKIPPED ("Email is not set up (RESEND_API_KEY)"), and
  the bell works exactly as before.
- **New notifications:**
  - `PO_SUBMITTED` and `RR_SUBMITTED` go to the approvers. The PO one carries the supplier, kitchen and total; the RR
    one carries the accepted value and whether any line differs from the order.
  - `PR_APPROVED` / `PR_REJECTED` go to the requester, with the purchase order it became or the reason.
  - `PO_APPROVED` / `PO_REJECTED` go to whoever submitted the order.
  - `RR_APPROVED` / `RR_REJECTED` go to whoever counted the delivery.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| E1 | **A separate `notificationEmail` column** rather than writing the owner's address into `User.email` (owner asked for "an email column", 2026-11-23) | `email` is the unique login, and the seed accounts sign in with it. Changing it would break logins, and it lives on domains nobody here owns |
| E2 | **Emailed:** waiting for a decision, decided, end of day (owner, 2026-11-23). **Bell only:** low stock, expiry, ledger mismatch, shortfall, transfers on their way or received, stock requests, returns | The bell-only kinds are acted on in the app the same day; an inbox full of them gets ignored. The list is `EMAILED_TYPES` in `services/notification.service.ts`. Task 3 adds the escalation reminder and Task 7 the weekly summary |
| E3 | **No per-user opt-out this week** (owner, 2026-11-23) | Clearing someone's notification address stops their email. Per-type preferences can come in Week 12 |
| E4 | **Its own `email` queue and worker:** one at a time, at most 2 a second, 3 attempts with a 30 s backoff | Resend is an outside service with a rate limit. A slow send must hold up neither a notification nor an AI job, the same reasoning as the `ai` queue |
| E5 | **Plain `fetch` to Resend's REST API**, no SDK | One endpoint, and no new dependency (CLAUDE.md) |
| E6 | **Idempotent:** the job id is `notification-email-<id>`; Resend's `Idempotency-Key` is `notification-<id>`; the worker skips a notification already logged `SENT` | A retry after a lost reply, or a re-run, can't send twice |
| E7 | **Logged once per email, after its last attempt.** A user with no address isn't logged | The log answers "did it go out?". Logging every by-design non-email (history staff) would bury the real ones |
| E8 | **Sender `KitchenERP <onboarding@resend.dev>` until a domain is verified** (`EMAIL_FROM`) | It works with no setup, but Resend delivers it only to the Resend account's own address. That's fine for testing, but not for real users |
| E9 | **The test email is sent from the request, not the queue** | The admin sees the result straight away. It isn't retried; press it again |

## What changed

- **Database:** migration `20261123230000_email_log`. It adds the `User.notificationEmail` column (nullable), the
  `EmailStatus` enum and the `EmailLog` table (indexes on `notificationId` and `createdAt`; both foreign keys
  `ON DELETE SET NULL`). Additive only.
- **Config:** optional `RESEND_API_KEY` and `EMAIL_FROM` (default `KitchenERP <onboarding@resend.dev>`). Empty
  placeholders are in `.env.example`; the real key goes in `.env` only.
- `lib/email.ts` (new): `sendEmail()` posts to Resend with a 15 s timeout. It maps a timeout, an unreachable server,
  429 or 5xx to retryable, and everything else to a refusal with Resend's message. The key is never logged.
- `lib/queue.ts`: `EMAIL_QUEUE`, `NOTIFICATION_EMAIL`, `EMAIL_JOB_OPTIONS`, `getEmailQueue()`, plus the job names
  `pr-decided`, `po-submitted`, `po-decided`, `rr-submitted` and `rr-decided` with their payload types.
- `repositories/notification.repository.ts`: `createMany` now returns `{ id, type }[]` (`createManyAndReturn`,
  still one INSERT). New `findForEmail()`.
- `repositories/email-log.repository.ts` (new). `repositories/user.repository.ts`: `listWithNotificationEmail`,
  `setNotificationEmail`, `findNotificationEmail`.
- `services/notification.service.ts`:
  - `notificationHref()` is exported, and its pages now cover `PurchaseOrder` and `ReceivingReport`.
  - `EMAILED_TYPES`.
  - `createAndPush` queues the email copies.
  - Five new notifiers: `notifyPurchaseRequestDecided`, `notifyPurchaseOrderSubmitted`,
    `notifyPurchaseOrderDecided`, `notifyReceivingReportSubmitted` and `notifyReceivingReportDecided`.
- `services/email.service.ts` (new): `renderEmail`, `sendNotification`, `sendToUser` (Tasks 6–7 send reports through
  it), `sendTest`, `setNotificationEmail`, `overview`.
- `services/purchase-request|purchase-order|receiving-report.service.ts`: queue the new jobs after each commit.
- `worker/index.ts`: handlers for the five new jobs, and a third worker on the `email` queue.
- **API:** `POST /api/email/test` and `PUT /api/email/recipients/[userId]` (new), guarded `/api/email` → ADMIN in
  `middleware.ts`.
- **UI:**
  - `app/(protected)/admin/email/page.tsx` and `components/email/SendTestEmail.tsx` / `NotificationEmailField.tsx`
    (all new).
  - Nav: Admin → Email.

## How to test

**First, restart `npm run dev` and `npm run worker`**, with one of each:
- Your current dev server (port 3001) started before today's second `prisma generate`. Admin → Email gives a 500
  ("reading 'findMany'") until it restarts.
- I stopped two orphaned processes from 09:14, an `npm run dev` on port 3000 and an `npm run worker`. Their
  terminal had closed (no TTY), the old server's `/login` returned 404, and the old worker was failing the new jobs
  as "Unknown job name". Your terminals' own processes were left running.

Your six seed accounts have your address as their notification email. It was set in the local database only; it is
not in any file. History staff have none.

1. **Without a key** (as now). Log in as `admin@kitchen.com` and open Admin → Email:
   - You should see "Not set up", the sender, "6 of 12 users have a notification address", and five SKIPPED rows
     from my checks.
   - Click **Send a test email to me**: a red "Email is not set up…" message, and a new SKIPPED Test row.
2. **Add a key:**
   - Create an API key at resend.com, under the account that uses your address.
   - Put it in `.env` as `RESEND_API_KEY=…` and restart dev and the worker.
   - Admin → Email now shows "Resend key set". Click **Send a test email to me**: green "Sent to …". It arrives within
     a minute (check spam), and the row is SENT.
3. **A real notification by email:**
   - As `procurement@kitchen.com`, raise and submit a purchase request.
   - As accounting, approve it in Approvals.
   - Procurement's bell gets "PR-… was approved — it is now PO-…", and the same arrives by email with a button that
     opens the request.
   - Then submit the PO as procurement: accounting and admin both get "PO-… is waiting for approval" in the bell and
     by email.
4. **Who gets nothing:**
   - In Admin → Email, clear the viewer's address and Save ("Saved"). The field shows "No emails".
   - Type something invalid and Save: "Enter a valid email address".
   - Put your address back.
5. **As procurement:** `/admin/email` sends you to Unauthorized.

Prisma Studio: `EmailLog` has one row per email, `Notification` has the new `PO_SUBMITTED` / `RR_SUBMITTED` / `PR_…` /
`PO_…` / `RR_…` rows, and `User.notificationEmail` is set on the six seed accounts.

What I verified:
- **Through the running worker:**
  - PR-000250 approved → `PR_APPROVED` to procurement.
  - PO-000240 submitted → `PO_SUBMITTED` to admin, seed accounting and the history accountant. The body was "Juan
    Procurement submitted 1 line from Nueva Ecija Fresh Produce for Main Commissary, ₱465.60 (from PR-000250)".
  - PO-000240 approved → `PO_APPROVED` to procurement, emailed → SKIPPED (no key).
  - RR-000267 submitted → `RR_SUBMITTED` to the three approvers ("₱465.60 accepted, as ordered"), then rejected →
    `RR_REJECTED` to procurement with the reason.
  - Email log: SKIPPED for admin, seed accounting and procurement. The history accountant (no address) got the bell
    and no log row, as designed.
- **The test email without a key:** 409, logged SKIPPED.
- **The send path against a stubbed Resend** (a dummy key in one process, so nothing left the machine):
  - 429 → RETRY, not logged
  - a timeout on the last attempt → FAILED "Resend timed out"
  - 422 → FAILED with Resend's message
  - 200 → SENT with its id
  - a re-run → ALREADY_SENT, no fourth call
  - The `Idempotency-Key` was set, the button links to the right page, the text part reads well, and HTML in a
    title is escaped.
  - Those three stub rows were deleted from the log afterwards.
- **Over HTTP:** procurement → `/admin/email` and `/api/email/test` redirect to /unauthorized; a bad address → 400 "Enter
  a valid email address"; a missing field → 400.
- **Services:** clearing an address works; an unknown user → 404.
- **Bug I caught:** the first version used `notification-email:<id>` as the job id. BullMQ refuses `:` ("Custom Id
  cannot contain :"), and the try/catch quietly kept the bell while dropping the email. Fixed to
  `notification-email-<id>` and re-checked as above.
- `tsc` and `eslint` are clean, and `prisma migrate diff` shows no drift.

## Risks and follow-up

- **`onboarding@resend.dev` reaches only your Resend account's address.** Before real users get email, verify a
  domain in Resend and set `EMAIL_FROM` (Week 12, with the deploy).
- **Emails for notifications written while the key was missing are not re-sent** when a key is added. They stay
  SKIPPED; the bell has them.
- **`NEXT_PUBLIC_APP_URL` is the button's base.** Locally it is `http://localhost:3000`. On a deployed system it
  must be the public URL.
- **Test data**, tagged `[W11T2 test]`: PR-000250 / PO-000240 (approved, sent) and RR-000267 (rejected). Removed at
  "clean up", together with the Task 1 items.
