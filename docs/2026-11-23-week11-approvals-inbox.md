# 2026-11-23 — Unified approvals inbox and one-click approve / reject (Week 11, Task 1)

The first Week 11 task. It covers two roadmap items:
- "Unified approvals inbox: all pending PRs, POs, RRs, Production Orders (plans and completions), Conversions,
  Write-offs and Transfers in one queue".
- "One-click approve/reject with comment".

It also covers the first half of the deliverable, "Accounting approver clears 5 pending items in 2 minutes from one
screen".

What it gives:
- **One queue.** The approvals page (`/procurement/approvals`, now under Overview in the nav) lists every pending
  document of the 8 types in one list, oldest first. Each row shows:
  - its type, number (linked to the full page) and how long it has waited
  - what it is ("Lechon — 40 kg"), the branch and who submitted it
  - the value ("Est. total", "Total", "Accepted", "Unit cost", "Value")
  - the same badges as the old per-type tables: short, price missing, go negative, lot short, lines that differ from
    the order.

  A row waiting 24 hours or more has a red edge and a red "waiting …". Filter chips: All, Over 24 h, and one per type
  with its count.
- **Decided in place.** Approve is one click. Reject needs the reason typed in the row's comment box first. A comment
  typed before Approve is saved as the approval's remarks. A decided row leaves the list at once and shows in a
  "Just decided" strip (✓ / ✗ and the number). A refusal from the server shows on the row in red, for example:
  - decided meanwhile by someone else
  - the source is no longer there
  - a price is missing
- **Your own documents** (you raised, submitted, counted or reported them) show no buttons, only "You submitted this
  — another approver decides it". The server refused these anyway.
- The page re-renders every minute, so other approvers' decisions and new submissions appear without a reload.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| A1 | **One merged queue, oldest first, with filter chips** — instead of Approve buttons on the eight tables | "Oldest first" across documents is what clears a backlog, and eight tables cannot show it |
| A2 | **The inbox reuses each document's own pending list** (`PurchaseRequestService.list`, `ProductionOrderService.listPending`, `listPendingCompletions`, `ConversionOrderService.listPending`, …). `ApprovalInboxService` only maps them onto one row shape | No figure is worked out twice. Every badge is the one the document page and the old table showed |
| A3 | **Decisions still go through `POST /api/approvals`, unchanged** | Every rule stays in its service: self-approval, still pending, a reason to reject, stock re-checked under a lock |
| A4 | **`submittedAt` on PR, PO and RR.** Production plans and completions take the time from their status log; conversions, write-offs and transfers are created pending, so their `createdAt` | Those three had no submit time, and `updatedAt` changes for other reasons. The escalation job (Task 3) needs a reliable clock |
| A5 | **Reject needs a comment; approve does not** (owner, 2026-11-23) | Whoever submitted it must know what to change. Every service already enforced it; the row now asks before posting |
| A6 | **No bulk "approve selected"** (owner, 2026-11-23) | Each decision moves stock or money. One click per item already meets "5 in 2 minutes" |
| A7 | **Ages are measured from the server render** (`now` passed down) and moved on by `AutoRefresh` every minute | Server and browser show the same "waiting 5 h"; no hydration mismatch |
| A8 | **Approvals moves to the Overview nav group** (same URL) | It is no longer only procurement's; links in the bell and bookmarks keep working |
| A9 | **Fix: purchase request decisions are guarded** | See below |

### The purchase request race (fixed)

`PurchaseRequestRepository.applyDecision` updated the request without checking it was still pending. It was the
only one of the 8 types like that. Two approvers clicking Approve within the same moment both passed the service's
read-then-check, and both wrote an `Approval` row and a purchase order. With one-click approving that becomes
likely.

The decision now moves the status first with `PENDING_APPROVAL` in the `WHERE`
(docs/coding-conventions.md → Concurrency). The second click matches no row, writes nothing, and gets 409 "This
request was decided meanwhile". Submitting a request is guarded the same way, so a double-click submits once.

## What changed

- **Database:** migration `20261123220000_approval_submitted_at`.
  - `submittedAt TIMESTAMP(3)` (nullable) on `PurchaseRequest`, `PurchaseOrder` and `ReceivingReport`.
  - Backfilled only for rows pending at migration time: `updatedAt` for requests and orders (a pending document
    cannot be edited); `createdAt` for receiving reports, which have no `updatedAt`.
  - Additive; no existing column changes.
- `repositories/purchase-request.repository.ts`: `updateStatus` replaced by a guarded `submit` (stamps
  `submittedAt`); `applyDecision` moves the status first, guarded, and returns null when it was decided meanwhile.
- `repositories/purchase-order.repository.ts`: `submit` stamps `submittedAt`. The summary includes `submittedBy`.
- `repositories/receiving-report.repository.ts`: `submit` stamps `submittedAt`.
- `repositories/production-order.repository.ts`: `enteredStatusAt(ids, status)` returns the latest status-log change
  into a status.
- `services/purchase-request|purchase-order|receiving-report.service.ts`: the summary DTOs carry `submittedAt` and
  the submitter id; the PR service returns 409 for the guarded cases.
- `services/production-order.service.ts`: the pending DTOs carry `pendingSince` and the completion carries
  `completedById`.
- `services/approval-inbox.service.ts` (new): `APPROVAL_TYPES`, labels, `OVERDUE_HOURS` (24) and
  `ApprovalInboxService.list(viewer)`.
- `components/procurement/ApprovalInbox.tsx` (new): the queue, chips, rows and the "Just decided" strip.
- `app/(protected)/procurement/approvals/page.tsx`: replaced the 8 tables with the inbox, plus `AutoRefresh` (60 s).
- `app/api/approvals/route.ts`: `referenceType` is `z.enum(APPROVAL_TYPES)`. Same values; one list now.
- `lib/navigation.ts`: Approvals moved to Overview.
- `services/assistant-tools.ts`: the assistant's table guide mentions `submittedAt`.
- **API:** no new endpoint. `/api/approvals` is unchanged, except that a purchase request decided by someone else
  a moment earlier now returns 409 instead of a second purchase order.
- **Config:** none.

## How to test

**Restart `npm run dev` first.** It still has the Prisma client from before the migration, so the new column reads as
missing. The worker restarts itself.

Test data is prepared and stays until you say "clean up". It's tagged `[W11T1 test]` in its notes, on top of
`npm run seed:history` (re-run today: 90 days, 3 kitchens + 3 outlets). Waiting for you:

| Type | Number | Note |
|---|---|---|
| Purchase request | PR-000245 | priced, Main — **backdated 30 h** |
| Purchase request | PR-000246 | not priced, Pasig |
| Purchase request | PR-000247 | raised by **admin** |
| Purchase order | PO-000238 | Divisoria, from PR-000248 |
| Receiving report | RR-000266 | against PO-000237, first line 10 % short |
| Production plan | PRD-000561 | Lechon 40 kg at Main — short 1 of 8 |
| Production plan | PRD-000562 | Bopis 24 kg at Pasig — in stock |
| Production completion | PRD-000563 | Dinuguan 9.6 of 10 kg at Main |
| Conversion | CNV-000056 | 6 kg Lechon → 9.5 kg Paksiw at Main |
| Write-off | WO-000283 | 1 kg Dinuguan at Main, spoiled |
| Transfer | TRF-000261 | Bopis 2 kg Pasig → Makati — **backdated 27 h** |

The base seed's own pending requests PR-000004 to 007 (from September) are in the queue too. PR-000006 and PR-000007
were raised by admin.

1. As `accounting@kitchen.com` (password `password123`): Overview → Approvals.
   - You should see "15 waiting for a decision, 6 for over 24 hours".
   - The six overdue rows come first, with red edges.
   - The chips read: All · 15, Over 24 h · 6, Purchase requests · 7, Purchase orders · 1, Receiving reports · 1,
     Production plans · 2, Production completions · 1, Conversions · 1, Write-offs · 1, Transfers · 1.
2. Time yourself: Approve PRD-000562, WO-000283, CNV-000056, PO-000238, RR-000266. Each row disappears and shows ✓ in
   "Just decided".
3. PR-000246: click Reject with the comment empty. It asks for the reason. Type "Use the Pasig stock first", then
   Reject. It shows ✗.
4. As `admin@kitchen.com`: PR-000006, PR-000007 and PR-000247 show "You submitted this — another approver decides
   it".
5. The race: open Approvals as accounting in one browser and as admin in a private window. Approve the same document
   in both, quickly. One approves; the other shows "decided meanwhile" (or "no longer awaiting a decision" if it was
   slower).
6. As `procurement@kitchen.com`: `/procurement/approvals` goes to Unauthorized.

Check in Prisma Studio:
- **Approval:** one row per decision. PR-000246's row is `REJECTED` with your remarks.
- **PurchaseRequest:** PR-000246 is `REJECTED`; PR-000245 to 247 have `submittedAt`.
- **Stock:** the write-off, conversion and RR moved stock as they always did (Stock Ledger / End of Day).

What I verified:
- Over HTTP:
  - two approvals of PR-000249 at once: 200 and 409 "decided meanwhile"; 1 `Approval` row and 1 purchase order
  - admin approving their own PR-000247: 403
  - rejecting with a blank reason: 400
  - an unknown `referenceType`: 400
  - procurement opening the page: redirected to /unauthorized
- A second submit of the same PR: 409.
- The inbox read as accounting and as admin in a fresh process: 15 items, oldest first, badges and values as the old
  tables, admin's three marked as theirs.
- `tsc` and `eslint` are clean, and `prisma migrate diff` shows no drift.

## Risks and follow-up

- **The dashboard's "purchase requests to approve" card** still counts purchase requests only. A total over all 8
  types would have to run every stock check the inbox runs. A count-only path can be added if you want it.
- **Each type still loads at most 100 at once**, as before. Past that, the oldest 100 show with a note.
- **Escalation (Task 3)** reads the same `pendingSince`. Documents decided before today have no `submittedAt`, which
  doesn't matter because they aren't pending.
- **History data** was re-run today. `npm run seed:history -- --clean` removes it; the `[W11T1 test]` items are
  removed separately at "clean up".
