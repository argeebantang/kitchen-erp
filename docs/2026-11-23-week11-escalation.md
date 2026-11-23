# 2026-11-23 — Escalation: re-notify approvers after 24 hours (Week 11, Task 3)

Covers the roadmap item "Escalation job: re-notify approver if an item has been pending for 24+ hours".

What it gives:
- **An hourly sweep, 07:00–21:00 Manila.** Anything in the approvals inbox that has waited 24 hours or more is
  reminded to each approver (ACCOUNTING and ADMIN) who didn't submit it. It reminds again at 48 h, 72 h and so on,
  once per 24-hour step, for as long as the document waits. There are no reminders at night: something that crosses
  24 h at 02:00 is reminded at 07:00.
- **One digest per approver per run**, in the bell and by email:
  - one document: "PR-000251 has waited 1 d 6 h for a decision"
  - several: "4 approvals have waited over 24 hours", naming up to five, oldest first, each with its type and age,
    then "+N more" and "N in all are over 24 hours" when some were already reminded at this step
- **The reminder opens the inbox already filtered** to "Over 24 h" (`/procurement/approvals?filter=overdue`).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| X1 | **An hourly sweep, not a delayed job per document** | It survives worker restarts and needs no clean-up when a document is decided. It reads the inbox as it stands, so a document decided meanwhile is simply not there |
| X2 | **Once per 24-hour step, per approver per document**, recorded in `ApprovalReminder` under a unique key and claimed before anything is written | A reminder can't go twice, even if two runs overlap. A run that crashes between the claim and the write loses that step's reminder; the next step, 24 h later, sends it. Missing one is better than nagging twice |
| X3 | **To the same approvers, minus the submitter**: ACCOUNTING and ADMIN, like the request itself (owner, 2026-11-23) | There's no higher approver in this business. Nobody is asked to decide their own document |
| X4 | **A digest, not one message per document** | Ten overdue items would otherwise be ten emails an hour |
| X5 | **07:00–21:00 only** (cron `0 7-21 * * *`, Manila) | Nobody approves at 03:00, and a 03:00 email would only be read at 07:00 anyway |
| X6 | **The inbox's own list and "waiting since"** (`ApprovalInboxService.list`, read as ADMIN so every purchase request is in it). `ApprovalItemDto` gains `submittedById` | No second calculation of what is pending or since when. The per-approver exclusion needs the submitter, not the viewer's `mine` |
| X7 | **Only the current step is reminded.** Something first seen at 50 h gets its 48 h reminder, not a 24 h one as well | A reminder says how long it has waited now |

## What changed

- **Database:** migration `20261123235000_approval_reminder`, which adds the `ApprovalReminder` table (unique on
  `userId, referenceType, referenceId, tier`; user FK `ON DELETE CASCADE`). Additive only.
- `repositories/approval-reminder.repository.ts` (new): `claim()` does `createManyAndReturn` with `skipDuplicates` in
  one statement.
- `services/notification.service.ts`: `notifyOverdueApprovals(now)`; `APPROVAL_OVERDUE` added to `EMAILED_TYPES`; the
  `ApprovalInbox` link added.
- `services/approval-inbox.service.ts`: `submittedById` on every row.
- `lib/format.ts`: `formatWaited()` ("40 min", "5 h", "1 d 3 h") moved here from the inbox component, so the page and
  the reminder text say the same.
- `lib/queue.ts`: `APPROVAL_ESCALATION` in `DAILY_JOBS` (`0 7-21 * * *`). `worker/index.ts`: its handler.
- `app/(protected)/procurement/approvals/page.tsx` and `components/procurement/ApprovalInbox.tsx`: `?filter=overdue`
  opens on the "Over 24 h" chip when anything is overdue.
- **API:** no new endpoint. The bell's `href` for `ApprovalInbox` is `/procurement/approvals?filter=overdue`.
- **Config:** none.

## How to test

**Restart `npm run worker`** (Ctrl+C, then `npm run worker`). Your running worker (started 12:49) didn't reload after
these edits, so it doesn't know the new job or its schedule yet. On start it should print
`approval-escalation scheduled "0 7-21 * * *" Asia/Manila — next run …`. The dev server needs no restart.

Test data, tagged `[W11T3 test]`, backdated:

| Document | By | Waiting |
|---|---|---|
| PR-000251 | procurement | 30 h |
| PR-000252 | **admin** | 26 h |
| WO-000284 | production | 50 h |
| TRF-000262 | production | 5 h — not overdue |

The base seed's PR-000004 to PR-000007 (from September, 70+ days) are overdue too. PR-000006 and PR-000007 were raised
by admin.

I already ran three sweeps from a script (see below), so every reminder for "now" has been sent. To see a fresh one:
1. Make one new overdue item: Prisma Studio → StockTransfer → TRF-000262 → set `createdAt` 25 hours back, and save.
2. Run `npm run job -- approval-escalation`. The worker prints `8 overdue; 3 reminder(s) due → wrote 3
   notification(s)`, or similar, depending on what has crossed a step since.
3. As `accounting@kitchen.com`, the bell shows "TRF-000262 has waited 1 d 1 h for a decision". Click it and Approvals
   opens on "Over 24 h", red rows only. The same reminder arrives by email.
4. Run `npm run job -- approval-escalation` again. The worker prints `0 reminder(s) due`. Nothing new in the bell.
5. As `admin@kitchen.com`, the reminders never name PR-000006, PR-000007 or PR-000252, which admin raised.
6. Approve or reject TRF-000262 in Approvals. At the next step nobody is reminded about it.

Prisma Studio → `ApprovalReminder`: one row per approver, document and step. `EmailLog`: one row per digest emailed.

What I verified (from a fresh process; your worker sent the emails):
- **First sweep:** 7 overdue (the four September requests, PR-000251, PR-000252, WO-000284; not TRF-000262), 18
  reminders claimed, 3 digests:
  - admin, 4 items: without PR-000006/007/252
  - seed accounting, 7
  - the history accountant, 7 (bell only, since they have no address)
- **Second sweep straight away:** 0 reminders.
- **"Now + 12 h":** only the September requests crossed their next step (72 d 13 h → 73 d 1 h); 10 reminders.
- **"Now + 24 h":** everything moved up a step, and TRF-000262 was reminded for the first time; 11 reminders.
  WO-000284 was claimed at step 2 and then 3, never step 1.
- **Emails:** 6 digests SENT to the seed users' address, plus the 7 "waiting for approval" emails for the test items.
- **Over HTTP:**
  - The bell's `href` is `/procurement/approvals?filter=overdue`.
  - The page opens with "Over 24 h · 7" pressed, showing exactly those seven.
  - The summary reads "8 waiting for a decision, 7 for over 24 hours".
- `tsc` and `eslint` are clean, and `prisma migrate diff` shows no drift.

## Risks and follow-up

- **Long-forgotten documents get a reminder every day forever**, as the seed's September requests now do. That's
  intended ("re-notify while pending"). Decide or reject them to stop it.
- **The sweep loads the whole inbox each hour** (up to 100 per type, with its stock checks). That's fine at this
  size; a count-only path would be the fix if it ever gets slow.
- **`ApprovalReminder` rows are never pruned.** At a few dozen a day that's negligible. They could be deleted once
  their document is decided.
- **Test data:** removed at "clean up", together with the reminders and notifications it produced.
