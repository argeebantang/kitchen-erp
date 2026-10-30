# Week 4 — Receiving Report & Stock Update

Delivered task by task. This note is appended to as each lands.

## Design decisions settled before building

| Area | Decision | Rationale |
|---|---|---|
| Stock location | `ReceivingReport.branchId` required. A "Main Commissary" branch is seeded and is the form's default. | Stock is per `materialId` + `branchId` (`InventoryLevel`'s unique key), so a delivery has to land somewhere specific. Real branch names were not supplied; the seed gives one to receive into. |
| Ledger location | `StockMovement.branchId` required | A movement without a branch cannot be replayed against `InventoryLevel`. Added now, while the table is empty, rather than backfilled later. |
| RR lifecycle | `RRStatus` = `DRAFT → PENDING_APPROVAL → APPROVED \| REJECTED`. `CONFIRMED` and `DISCREPANCY_FLAGGED` dropped. | The same shape as PR and PO, so `POST /api/approvals` and the shared components fit. A discrepancy is a property of the lines, not a status. |
| Variance | Derived from the lines, never stored | Expected, received and rejected are all on the line; a stored flag could disagree with them. Measured against `expectedQuantity` (Task 2). |
| Who counted it | `ReceivingReport.receivedById` required = **whoever saved the report last** | Lets "nobody approves their own work, ADMIN included" apply to RRs. See Task 1.8. The approver comes from the `Approval` row, as for PR and PO. |
| Line link | `ReceivingReportItem.purchaseOrderItemId` required | Outstanding is computed per PO line; a material can appear on an order once per line, so material alone is not a key. |
| Quantities | Stock in = received − rejected. `unitCost` copied from the PO line, not editable. | Accounting approved that price. Price disputes belong to invoicing/costing, not receiving. |
| Over-delivery | Not accepted. Accepted per line ≤ outstanding; anything extra is entered as rejected. | Accounting approved a quantity, not "whatever came". |
| Short delivery | Allowed; the PO moves to `PARTIALLY_RECEIVED` on approval (Task 4). No "close short" this week. | Suppliers deliver in parts. Closing an order short is a separate decision for later. |
| RRs per PO | Many, but at most one `DRAFT`/`PENDING_APPROVAL` at a time | One delivery is recorded at a time, so outstanding on the form is never computed against another unfinished count. |
| Receivable PO | `SENT` and `PARTIALLY_RECEIVED` only | Nothing is delivered before the order is sent; a fully received or cancelled order takes nothing more. |
| Who records | ADMIN and PROCUREMENT_MANAGER (the existing `/procurement/receiving` guard) | Accounting gets read access in Task 3, to approve. |
| Rejected RR | Terminal; a recount is a new RR | Same rule as PR and PO. |
| Approval (Task 4) | One `$transaction`: RR status (`WHERE PENDING_APPROVAL`) · `Approval` row · `StockMovement` IN + `InventoryLevel` upsert per line · PO status from the cumulative accepted quantity. Outstanding re-checked under a PO row lock. | `docs/database.md` requires ledger and level to move together; the lock stops two approvals over-receiving one line. |
| Numbering | Postgres sequence `rr_number_seq`, formatted `RR-000001` | Same as `pr_number_seq` / `po_number_seq`. |

---

## Task 1 — RR form linked to an approved PO, actual received quantities per line

Procurement can record a delivery against a sent order, line by line, save it as a draft,
view it, and correct it while it is still a draft. Nothing reaches stock yet — that is Task 4,
on approval.

Built in subtasks 1.1–1.8, UI first.

**What changed**

- *1.1 Schema.* The columns, enum and indexes in the decisions table above, plus the
  `rr_number_seq` sequence. `Branch.receivingReports` / `stockMovements`,
  `User.receivingReports` (relation `"ReceivingReportReceiver"`) and
  `PurchaseOrderItem.receivingItems` back-relations. Seed: "Main Commissary" branch,
  find-then-create so re-seeding is idempotent.
- *1.2 List page.* `/procurement/receiving` lists reports newest first: number, order,
  supplier, branch, line count, date received, counted by, status. Empty state when there are
  none.
- *1.3 Entry point.* The order page has a **Receive delivery** button for procurement on `SENT`
  and `PARTIALLY_RECEIVED` orders, and a "Receiving reports" card listing the order's RRs.
- *1.4 Form.* `/procurement/receiving/new?po=<id>` shows every PO line with ordered, already
  received (approved RRs only) and outstanding, and inputs for received, rejected and a line
  note. Accepted is shown live. Received starts blank, not pre-filled with outstanding, so a
  draft cannot be saved without someone counting. The page explains instead of showing the
  form when the order is not receivable, another RR is open on it, or there is no active
  branch.
- *1.5 Create.* `POST /api/receiving-reports` → `ReceivingReportService.create` →
  `ReceivingReportRepository.create`, which takes the number from `rr_number_seq` and writes
  the report and its lines in one transaction. `receivedById` comes from the `x-user-id`
  header, never the body.
- *1.6 Server validation* (`validateCounts`, shared by create and edit): the order is
  receivable (409), the branch exists and is active (400), the date is not after today in
  Asia/Manila (400), every PO line is counted exactly once and belongs to the order (400),
  rejected ≤ received (400), accepted ≤ outstanding (400, "only X kg is outstanding — enter
  the extra as rejected"), and not every line is zero (400). Create also refuses a second open
  RR on the order (409). All arithmetic in `Prisma.Decimal`; the form's own checks compare in
  millionths and exist only for the person typing.
- *1.7 Detail page.* `/procurement/receiving/[id]`: the order (linked, with its status),
  branch, date, who counted it, notes, and per line ordered / received / rejected / accepted /
  unit cost / accepted value, with the total value that will go into stock on approval.
- *1.8 Edit a draft.* `PATCH /api/receiving-reports/[id]` and
  `/procurement/receiving/[id]/edit`, reusing the form. `DRAFT` only, same validation as
  create. The repository's `updateDraft` puts `status = DRAFT` in the UPDATE's `WHERE` (the
  `moveStatus` pattern), so an edit racing a submit writes nothing and returns 409. Ordered
  quantity, unit cost and material are never rewritten. After saving, create and edit both land
  on the report's page.

**Why "whoever saves becomes the counter" (1.8)**

The approver must not be the person who counted (Task 3). If an edit left `receivedById`
alone, Admin could change Juan's counts and then approve them — the check would compare Admin
with Juan and pass, and the report would name the wrong person. Making the saver the counter
blocks that: Admin's edit makes Admin the counter, so accounting approves. Accounting can never
create or edit an RR, so there is always someone allowed to approve.

| Option | How | Cost |
|---|---|---|
| **A. Whoever saves becomes the counter** (chosen) | `receivedById` = last saver | The original counter's name is lost after someone else edits |
| B. Only the original counter may edit | Others get 403 | Nobody can fix a typo while the counter is away |
| C. Keep the counter, add "last edited by" | New column; approval blocks both | Schema change and a wider check for a rare case |

The edit page says "Saving makes you the person who counted it."

**Other choices**

| Decision | Chosen | Why |
|---|---|---|
| `orderedQuantity` on the RR line | The PO line's quantity, not the outstanding at the time | It is what the order said. Task 2 added `expectedQuantity` for the outstanding at the time, rather than changing what this column means. |
| Outstanding | Counts `APPROVED` RRs only | A draft or rejected count has not put anything into stock. It also means a draft never counts against itself when edited. |
| "Today" | `lib/dates.ts` `todayIsoDate()` in Asia/Manila | The server's clock is UTC; between midnight and 8 a.m. Manila it would call today "yesterday" and reject a correct date. |
| Dates | Stored as UTC midnight (`new Date('YYYY-MM-DD')`), shown with `.slice(0, 10)` | A date-only value; no time zone conversion on display. |
| Deactivated branch on edit | Kept in the picker | Opening the edit page must not silently move a draft to another branch. |

**Files affected**

- `prisma/schema.prisma`, `prisma/migrations/20261029065124_week4_receiving_report/migration.sql` (new), `prisma/seed.ts`
- `middleware.ts`
- `lib/dates.ts` (new)
- `repositories/branch.repository.ts` (new), `repositories/receiving-report.repository.ts` (new)
- `services/receiving-report.service.ts` (new)
- `app/api/receiving-reports/route.ts` (new), `app/api/receiving-reports/[id]/route.ts` (new)
- `components/procurement/ReceivingReportForm.tsx` (new)
- `app/(protected)/procurement/receiving/page.tsx`, `new/page.tsx`, `[id]/page.tsx`, `[id]/edit/page.tsx`, `not-found.tsx` (all new)
- `app/(protected)/procurement/orders/[id]/page.tsx`
- `.gitignore` — `*.xlsx` and `~$*`: local task-tracker workbooks and Excel's lock files stay out of git
- `docs/progress.md`, `docs/2026-10-29-week4-receiving.md`, `kitchenERP-sprint-v3.jsx`

**Database changes**

Migration `20261029065124_week4_receiving_report`, generated with `prisma migrate diff`, read,
hand-appended with `CREATE SEQUENCE "rr_number_seq"`, applied with `prisma migrate deploy`.

- `RRStatus` recreated as `DRAFT, PENDING_APPROVAL, APPROVED, REJECTED`.
- `NOT NULL` columns: `ReceivingReport.branchId`, `ReceivingReport.receivedById`,
  `ReceivingReportItem.purchaseOrderItemId`, `StockMovement.branchId`, each with an
  `ON DELETE RESTRICT` foreign key.
- Indexes: `ReceivingReport` on `purchaseOrderId`, `status`, `branchId`;
  `ReceivingReportItem` on `receivingReportId`, `purchaseOrderItemId`; `StockMovement` on
  `(materialId, branchId, createdAt)` for the ledger view and `(referenceType, referenceId)`
  for looking up an RR's movements (Task 5).
- Sequence `rr_number_seq`.

The enum recreate and the `NOT NULL` additions without defaults are only valid because
`ReceivingReport`, `ReceivingReportItem` and `StockMovement` held zero rows when it was
applied (checked first). Against real data this would need the additive path: nullable
columns, backfill, then tighten. Drift check after applying: empty.

**API changes**

| Endpoint | Success | Errors |
|---|---|---|
| `POST /api/receiving-reports` | 201 `{ receivingReport: { id, rrNumber } }` | 400 validation · 401 no session headers · 403 role · 404 unknown order · 409 order not receivable / another RR open |
| `PATCH /api/receiving-reports/[id]` | 200 `{ receivingReport: { id, rrNumber } }` | 400 validation · 401 · 403 · 404 unknown report · 409 not a draft / changed while editing |

Body: `branchId`, `receivedAt` (`YYYY-MM-DD`), `notes`, `items[]` of `purchaseOrderItemId`,
`receivedQuantity`, `rejectedQuantity` (non-negative decimal strings), `notes`; plus
`purchaseOrderId` on POST only. New middleware guard: `/api/receiving-reports` → ADMIN,
PROCUREMENT_MANAGER.

**UI changes**

- New pages: `/procurement/receiving` (list), `/procurement/receiving/new?po=<id>`,
  `/procurement/receiving/[id]`, `/procurement/receiving/[id]/edit`, and a "Not found" page
  for unknown ids.
- Order page — **Receive delivery** button and a "Receiving reports" card.

**Configuration changes**

None. After pulling: `npx prisma migrate deploy && npx prisma generate`, re-seed for the
branch, restart dev and the worker.

**How to verify**

```bash
npx tsc --noEmit && npm run lint
npm run build        # stop `npm run dev` first; it clobbers .next
```

As `procurement@kitchen.com`, open a `SENT` order → **Receive delivery**. Leave a line blank:
refused. Accept more than outstanding: the line is flagged and the server returns 400. Count
it properly → **Save draft**: you land on `RR-00000N`, listed on `/procurement/receiving` and
on the order's card. **Edit** → change Rejected → **Save changes**: accepted and value update.
Try **Receive delivery** again on the same order: "RR-00000N is already open". Set the RR's
status to `PENDING_APPROVAL` in the database and save the open edit page: 409, and the Edit
button is gone. As `accounting@`, `/procurement/receiving` redirects to `/unauthorized`.
`StockMovement` and `InventoryLevel` are unchanged throughout.

**Risks / assumptions / follow-up**

- The "one open RR per order" check in `create` is a read followed by an insert, not a
  database constraint; two people saving at the same instant could both get a draft. Harmless
  for stock — Task 4 re-checks outstanding under a row lock — but untidy. A partial unique
  index on `purchaseOrderId WHERE status IN ('DRAFT','PENDING_APPROVAL')` would close it.
- **Receive delivery** still shows while an RR is open on the order; the new page then
  explains why it is blocked.
- Editing replaces the counter's name with no history (option A above).
- Only one branch exists; real branch names are still to come.
- No submit yet: a draft stays a draft until Task 3, and accounting cannot see RRs until then.
- Line edits run one `updateMany` per line inside the transaction — fine at PO sizes, not
  batched.

---

## Task 2 — Variance detection

Every receiving line is split into **short**, **over-delivered** and **rejected**, each with its
peso value, and shown on the report, in the form as you type, and as a badge on the receiving
list and the order page. A rejected quantity now needs a line note. Variance is a flag, not a
block: accounting sees it when approving (Task 3).

Built in subtasks 2.1–2.5.

**Decisions**

| Area | Decision | Rationale |
|---|---|---|
| Measured against | **Expected** = what was outstanding on the PO line when the delivery was counted — not the ordered quantity | Against ordered, every follow-up delivery of a split order looks short: 10 kg ordered, 6 then 4 arrive, and the second report would say "short 6". |
| Where expected comes from | Stored per line as `ReceivingReportItem.expectedQuantity`, rewritten on every draft save | Once a report is approved its own acceptance is part of outstanding, so the figure cannot be derived back — a matched 4 kg delivery would read as over-delivered by 3. One open RR per order means nothing else moves outstanding while it is counted, so the stored figure stays true until approval. Rebuilding it from approval history was the alternative; rejected as fragile. |
| Variance itself | Still derived, never stored | Expected is a fact about the delivery; the split is calculated from it. |
| Kinds | short = max(expected − accepted, 0) · over = max(received − expected, 0) · rejected = rejected − over | Task 1 makes the extra on an over-delivery go under rejected, so over is always part of the rejected column; the remainder is goods refused for another reason. |
| Money | Each kind × the line's unit cost | Accounting approves pesos. |
| Notes | Required on a line with rejected > 0 (incl. over-delivery); optional on a short line | Whoever refused goods at the door says why. A shortfall stays outstanding on the order — nothing is lost. |
| Tolerance | None: 9.98 kg against 10 kg is short 0.02 | Add one (e.g. ±1% for items sold by weight) if exact flags prove to be noise. |
| Price variance | None | Unit cost is copied from the PO line and cannot be edited on an RR. |

**What changed**

- *2.1 Detail page.* `lineVariance()` in the service splits each line in Decimal; `getById`
  returns `expectedQuantity` and `variance` per line and a report total (lines with variance,
  short / over / rejected values). New Expected and Variance columns, and a banner — green
  "No variance", or amber with the peso totals and "short quantities stay outstanding".
  `VarianceChips` renders the per-line chips; it takes strings and has no `'use client'`, so
  the form reuses it.
- *2.2 Stored expected.* `expectedQuantity` column (migration below), written from outstanding
  by `validateCounts` on create and on every edit; `getById` reads the stored figure instead of
  recomputing it, which also drops a query from the detail page.
- *2.3 Live variance in the form.* The same split for the person typing, in millionths like the
  form's other checks, with a summary above Save once every line is counted. `ReceivingLineDto`
  now carries `unitCost`.
- *2.4 Note rule.* `validateCounts` returns 400 "a rejected quantity needs a note saying why";
  the form shows the same on the line and disables Save, while still showing the variance.
- *2.5 Badges.* `ReceivingReportRepository.varianceLineCounts(ids)` — one `groupBy` per page,
  counting lines where `rejected > 0 OR received < expected`. That condition is exactly "has a
  variance": over-delivery always shows up as rejected, and with nothing rejected, short means
  received < expected. The column-to-column comparison uses a Prisma 5 field reference
  (`prisma.receivingReportItem.fields.expectedQuantity`). `VarianceBadge` ("Match" /
  "Variance · N lines") on the receiving list and the order page's Receiving reports card.

**Files affected**

- `prisma/schema.prisma`, `prisma/migrations/20261029220219_rr_expected_quantity/migration.sql` (new)
- `repositories/receiving-report.repository.ts`, `services/receiving-report.service.ts`
- `components/procurement/VarianceChips.tsx` (new), `components/procurement/ReceivingReportForm.tsx`
- `app/(protected)/procurement/receiving/page.tsx`, `app/(protected)/procurement/receiving/[id]/page.tsx`, `app/(protected)/procurement/orders/[id]/page.tsx`
- `docs/database.md`, `docs/api.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

**Database changes**

Migration `20261029220219_rr_expected_quantity` adds `ReceivingReportItem.expectedQuantity
DECIMAL(65,30) NOT NULL`. Prisma's generated SQL was a single `ADD COLUMN ... NOT NULL`, which
fails on a table with rows (RR-000001's line), so it was hand-written as the additive path: add
nullable → backfill (ordered minus what *other approved* reports accepted on the line, floored
at 0) → `SET NOT NULL`. The backfill would mis-state a report that was already approved when a
later one was approved too; none existed (one DRAFT, verified). RR-000001's line became 4.
Drift check afterwards: empty.

**API changes**

No new endpoints. `POST /api/receiving-reports` and `PATCH /api/receiving-reports/[id]` return
400 when a line has a rejected quantity and no note.

**UI changes**

- RR detail page: Expected and Variance columns, variance banner.
- Receive / edit form: Variance column, live summary above Save, note-required message.
- Receiving list: Variance column. Order page: a badge per receiving report.

**How to verify**

```bash
npx tsc --noEmit && npm run lint
npm run build        # stop `npm run dev` first; it clobbers .next
```

Edit RR-000001 through these counts and check the detail page each time: received 3 / rejected
0 → Short 1 kg · ₱355.00; 4 / 0 → Match, green banner; 4 / 0.5 → Short 0.5 and Rejected 0.5,
and Save refused until a line note is written; 5 / 1 → Over-delivered 1 kg only. The receiving
list and PO-000002 show "Match" or "Variance · 1 line" to agree. Flip RR-000001 to `APPROVED` in
the database and reload: the variance is unchanged (then flip it back to `DRAFT`).

**Risks / assumptions / follow-up**

- Expected is only as good as the one-open-RR-per-order rule, which is a read-then-insert check
  in `create` (Task 1 risk). Two drafts saved at the same instant would share an expected figure.
  Task 4's re-check under a row lock still stops stock being over-received.
- The form's peso figures go through JS numbers; they are display only and can differ from the
  detail page in the last cent on unusual unit costs.
- No tolerance. Variance on weighed goods may be noisy.
- Variance is not yet surfaced to accounting — the approvals inbox gains RRs in Task 3.

---

## Task 3 — RR approval by accounting

Procurement submits a draft receiving report; accounting approves or rejects it from the
approvals inbox, through the same `POST /api/approvals` that PRs and POs use. Approving moves
only the report's status for now — Task 4 adds the stock update to the same transaction.

Built in subtasks 3.1–3.4.

**Decisions**

| Area | Decision | Rationale |
|---|---|---|
| Approval before stock | Approve flips the RR to `APPROVED` and writes the `Approval` row; Task 4 extends the same repository `decide()` with the ledger, stock levels and the order's status | A checkpoint between "the approval works" and "stock is right". Building both at once was the alternative. Cost: an RR approved while testing Task 3 has no stock movements, and its acceptance already counts toward outstanding while the PO stays `SENT` — reset before Task 4. |
| Self-approval | Approver compared with `receivedById`; submitting does not change it | Same rule as the PO's `submittedById` check, no new column. An admin who submits a draft Juan counted can still approve it: two people are involved. |
| Submit | Re-runs `validateCounts` on the saved counts | A draft saved under an older rule (RR-000001 had 0.5 rejected and no note before 2.4) or whose branch was deactivated must not reach accounting. |
| Rejection | Reason required; `REJECTED` terminal; outstanding untouched | Same as PR and PO. Procurement records a fresh count; a rejected report no longer counts as open. |
| Accounting access | Reads `/procurement/receiving`; cannot open the new form or the edit page; `/api/receiving-reports` stays procurement-only | Accounting decides through `/api/approvals` and never changes a count. |
| Notification | None on submit | Same as PO submit; Week 11's bell can add it. |

**What changed**

- *3.1 Submit.* `POST /api/receiving-reports/[id]/submit` → `ReceivingReportService.submit`
  (403 role, 404, 409 not a draft, the re-check, 409 lost race) → repository `submit`, via a
  private `moveStatus` with the expected status in the `WHERE`. `ReceivingReportActions` puts a
  "Submit for approval" card on a draft; a pending report shows "waiting for accounting".
- *3.2 Accounting read access.* `/procurement/receiving` guard and the sidebar link add
  ACCOUNTING; a narrower `/procurement/receiving/new` guard keeps recording to procurement; the
  edit page redirects other roles itself, since a prefix cannot match `[id]/edit`. The order
  page's `canOpenReceiving` flag is gone — every role on that page may now open receiving.
- *3.3 Inbox.* A "Receiving reports" section on `/procurement/approvals`: number, order,
  supplier, counted by, received, accepted value, variance badge. The header counts all three
  kinds. `ReceivingReportRepository.acceptedValues(ids)` sums
  `(received − rejected) × unitCost` per report in one raw query per page — `groupBy` can only
  sum a column, not an expression — and the list DTO gains `acceptedValue`.
- *3.4 Approve / reject.* `/api/approvals` accepts `referenceType: 'ReceivingReport'`;
  `ReceivingReportService.applyDecision` refuses 404 → 403 own count → 409 not pending → 400
  reject without a reason; repository `decide()` moves the status then writes the `Approval`
  row in one transaction. The RR page shows `ApprovalActions` to an approver who did not count
  it, "You counted this delivery…" to one who did, and `DecisionHistory`. `ApprovalActions`'
  reject hint now says "whoever submitted it" rather than "the requester".

**Files affected**

- `middleware.ts`, `lib/navigation.ts`
- `repositories/receiving-report.repository.ts`, `services/receiving-report.service.ts`
- `app/api/receiving-reports/[id]/submit/route.ts` (new), `app/api/approvals/route.ts`
- `components/procurement/ReceivingReportActions.tsx` (new), `components/procurement/ApprovalActions.tsx`
- `app/(protected)/procurement/receiving/[id]/page.tsx`, `app/(protected)/procurement/receiving/[id]/edit/page.tsx`, `app/(protected)/procurement/approvals/page.tsx`, `app/(protected)/procurement/orders/[id]/page.tsx`
- `prisma/schema.prisma` (comment only)
- `docs/api.md`, `docs/architecture.md`, `docs/database.md`, `docs/overview.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

**Database changes**

None. `Approval.referenceType` already takes any string; its comment in `schema.prisma` now
lists `'ReceivingReport'`. Drift check: empty.

**API changes**

- New: `POST /api/receiving-reports/[id]/submit` — 200 · 400 saved counts break a rule · 401 ·
  403 · 404 · 409 not a draft.
- `POST /api/approvals` accepts `referenceType: 'ReceivingReport'` and returns
  `{ receivingReport: { id, rrNumber } }`; 403 when the approver counted it.

**UI changes**

- RR page: Submit card (draft), Approve / Reject or "you counted this" (pending), decision history.
- Approvals inbox: Receiving reports section.
- Sidebar: Receiving for accounting. Order page: RR numbers always links.

**How to verify**

```bash
npx tsc --noEmit && npm run lint
npm run build        # stop `npm run dev` first; it clobbers .next
```

As procurement, submit RR-000001: it becomes PENDING APPROVAL and loses its Edit button. As
accounting, it appears in Approvals with its value and variance; Reject without remarks is
refused; Approve shows "Approved by Accounting User" and writes one `Approval` row with
`referenceType = 'ReceivingReport'`. `StockMovement` and `InventoryLevel` stay empty. As
accounting, `/procurement/receiving/new` and the edit page redirect to `/unauthorized`.

**Risks / assumptions / follow-up**

- Between Task 3 and Task 4, an approved RR has no stock movements and its order stays `SENT`
  although its outstanding has dropped. Any RR approved while testing is reset before Task 4
  (status back to `PENDING_APPROVAL`, its `Approval` row deleted).
- The self-approval check reads `receivedById` before the transaction. It cannot go stale —
  only a draft save changes it, and a pending report cannot be saved.
- The inbox is capped at 100 pending reports per section, like PRs and POs, with no paging.

---

## Task 4 — On RR approval: ledger entry written, stock levels updated

Approving a receiving report now puts its accepted goods into stock and moves the order to
partially or fully received — in the same transaction as the status change and the `Approval`
row, so either all of it happens or none of it does.

Built in subtasks 4.1–4.4.

**Decisions**

| Area | Decision | Rationale |
|---|---|---|
| One transaction | Extend 3.4's `decide()`; no second endpoint | `docs/database.md`: ledger and level move together, and both belong with the decision that caused them. |
| Lock | `SELECT status FROM "PurchaseOrder" WHERE id = … FOR UPDATE` first | Two approvals on one order queue instead of interleaving. Taken before the report's own row, so every approval locks in the same order and none can deadlock. |
| Re-check | Under the lock, cumulative accepted ≤ ordered on every order line; else 409 and full rollback | With one open RR per order it should never fire. It closes the create-time race from Task 1, where two drafts saved at once could both count the same outstanding. |
| Ledger rows | One `IN` per line with accepted > 0: quantity = received − rejected, the RR's branch, `referenceType 'ReceivingReport'`, `referenceId` = the RR, notes = RR number | Rejected goods never entered stock; a zero-quantity row says nothing. |
| Cost on the ledger | New `StockMovement.unitCost`, nullable, written on receiving `IN` (option A) | The purchase cost is a fact at receipt, and one column on an empty table was the cheapest it will ever be. Following `referenceId` back to the RR line was the alternative, ambiguous when an order lists a material twice. The costing method is still Week 6's. |
| Stock level | `InventoryLevel` upsert on (material, branch) with `increment` | Prisma issues one `INSERT … ON CONFLICT DO UPDATE` (seen in the query log), so even two first-time receipts of a material cannot lose an update. |
| Order status | From cumulative accepted: every line full → `FULLY_RECEIVED`; some → `PARTIALLY_RECEIVED`; none (all rejected) → unchanged | Short deliveries leave the order partially received; there is no "close short" yet (Task 1). |
| Structure | `InventoryRepository.stockIn(tx, …)`; `PurchaseOrderRepository.lockForReceiving(tx, …)` / `setReceivingStatus(tx, …)` | Week 3's transactions-across-repositories pattern: the caller's `tx` is passed down. Transfers, production and write-offs will reuse `InventoryRepository`. |
| Rejection | No lock, no stock | Nothing was accepted. |

**What changed**

- *4.1 Read path.* `InventoryRepository` (new) with `findMovementsByReference`, served by the
  `(referenceType, referenceId)` index from Task 1. The RR detail DTO gains `stockMovements`;
  a Stock card under the line table lists them (`+4 kg Pork Belly @ ₱355.00/kg → Main
  Commissary · IN · date`) or explains why there are none for the report's status.
- *4.2 Cost column.* `StockMovement.unitCost Decimal?`, migration below.
- *4.3 Approval posts stock.* `decide()`: lock → status (WHERE `PENDING_APPROVAL`) → `Approval`
  row → re-check via `acceptedByLine(poId, tx)` (now takes the transaction client; this report
  is already `APPROVED` inside the transaction, so the sum includes it) → `stockIn` per line →
  order status. A failure inside throws `ReceivingConflict`, which rolls the transaction back
  and is mapped to `{ ok: false, reason, message }`; the service returns 409 "… — nothing was
  changed. Reject it and record a fresh count."
- *4.4 Edge cases*, run through `applyDecision` on throwaway orders and deleted afterwards:
  partial then complete delivery (`PARTIALLY_RECEIVED` → `FULLY_RECEIVED`, levels add up,
  including onto an existing level row); all-rejected (no movement, order stays `SENT`); two
  approvals started together on one order line — the second waits for the lock and is refused,
  both when the first fills the order ("can no longer take a delivery") and when the order
  stays receivable ("would receive more than was ordered"); rejection writes nothing; an order
  cancelled while the report was pending refuses the approval with no `Approval` row left
  behind. No code changes were needed.

**Files affected**

- `prisma/schema.prisma`, `prisma/migrations/20261030034822_stock_movement_unit_cost/migration.sql` (new)
- `repositories/inventory.repository.ts` (new), `repositories/purchase-order.repository.ts`, `repositories/receiving-report.repository.ts`
- `services/receiving-report.service.ts`
- `app/(protected)/procurement/receiving/[id]/page.tsx`
- `docs/database.md`, `docs/api.md`, `docs/architecture.md`, `docs/overview.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

**Database changes**

Migration `20261030034822_stock_movement_unit_cost`: `ALTER TABLE "StockMovement" ADD COLUMN
"unitCost" DECIMAL(65,30);` — nullable, so additive on any table; it held 0 rows. Drift check:
empty. From here on, approving an RR writes `StockMovement` and `InventoryLevel` rows and
updates `PurchaseOrder.status`.

**API changes**

No new endpoints. `POST /api/approvals` with `referenceType: 'ReceivingReport'` and
`decision: 'APPROVED'` now also posts stock and returns 409 when the order can no longer take a
delivery or a line would be over-received.

**UI changes**

RR page: Stock card. The order page's status badge now moves to PARTIALLY / FULLY RECEIVED.

**How to verify**

```bash
npx tsc --noEmit && npm run lint
npm run build        # stop `npm run dev` first; it clobbers .next
```

Approve a pending RR as accounting: its Stock card lists one `+` row per line with something
accepted; `StockMovement` has those rows (type `IN`, `unitCost` set, `referenceType
'ReceivingReport'`); `InventoryLevel` rose by exactly those quantities at the RR's branch; the
order is PARTIALLY or FULLY RECEIVED. RR-000001 on PO-000002 was the first: +4 kg Pork Belly
at Main Commissary, PO-000002 fully received.

**Risks / assumptions / follow-up**

- Nothing yet reverses an approval. A wrong approved count needs a stock adjustment, which has
  no screen until the write-off / adjustment work.
- `setReceivingStatus` writes without a status guard; it is only safe because it runs under
  `lockForReceiving` after the status was checked. Keep it that way.
- `unitCost` is null for every future movement type until Week 6 decides costing.
- Over-delivery still never enters stock — the extra is rejected at the door (Task 1).
- The roadmap's next item, "Every movement writes to inventory_ledger with source document
  reference", is true for the only movement type that exists; Task 5 decides what more it needs
  (the ledger trail view).

---

## Task 5 — Every movement writes to the ledger with its source document

Receiving was already the only writer and already set a reference, so this task makes the rule
a database guarantee and gives the ledger a screen: the Stock Ledger, with each movement's
source document, a running balance, and a check that the ledger agrees with the stock level.

Built in subtasks 5.1–5.4.

**Decisions**

| Area | Decision | Rationale |
|---|---|---|
| Reference required | `StockMovement.referenceType` + `referenceId` `NOT NULL` | Every planned movement has a source document (RR, production order, transfer, write-off / adjustment). A column the database enforces beats a convention each future writer has to remember. |
| Signed quantities | Into stock positive, out negative | The balance is `SUM(quantity)` and must equal `InventoryLevel`. `MovementType` cannot carry direction: a `TRANSFER` is out at one branch and in at another. Always-positive with direction from the type was the alternative; it would have split `TRANSFER` in two later. Sets the rule for Weeks 5–8. No data changed — the one `IN` row was already positive. |
| Running balance | SQL window function over (material, branch), ordered by `createdAt, id` | Right on any page without loading earlier pages; uses the `(materialId, branchId, createdAt)` index. |
| Reconciliation | Ledger total vs `InventoryLevel`, ✓ / ✗, for one material at one branch | Cheap, and catches any future writer that bypasses `InventoryRepository`. |
| Access | Every signed-in role reads the ledger | Same as Stock Levels; no branch isolation exists yet (`docs/database.md`). |
| Source links | Document numbers resolved per page, one query per type; a link only for roles that can open it | Not read from the free-text `notes`. |
| Money | Per-row value (quantity × `unitCost`) where a cost exists; the balance in units | Valuing a balance is Week 6 costing. |

**What changed**

- *5.1 Ledger page.* `/inventory/ledger`, sidebar "Stock Ledger" for every role. Newest first,
  50 per page (Newer / Older); a GET form filters by material and branch, so a filtered ledger
  is a URL. Columns: date · material · branch · type · signed quantity · unit cost · value ·
  source. `InventoryRepository.findMovements` (paged, `id` breaks ties);
  `ReceivingReportRepository.numbersByIds`; new `InventoryService.ledger` builds the rows and,
  through `SOURCE_PAGES`, decides per role whether a source is a link — production orders and
  transfers each add one entry there.
- *5.2 Balance and reconciliation.* With both filters set: `runningBalances` (raw
  `SUM(quantity) OVER (ORDER BY "createdAt", id)`, filtered to the page's ids afterwards) adds
  a Balance column; `reconcile` puts the ledger's sum beside `InventoryLevel` (no row = 0), shown
  as "✓ Ledger 4 kg = stock level 4 kg" or a red mismatch. Checked with temporary rows +5, −2,
  +1 read one per page (balances 4, 3, 5) and with a level changed behind the ledger's back.
- *5.3 Links in.* Each row of the RR page's Stock card opens the ledger filtered to that
  material and branch. Task 6's stock-map tiles will link the same way.
- *5.4 Enforce.* Migration below; the model's doc comment records both rules and points
  writers at `InventoryRepository`; the service's null handling for `source` is gone. An
  `INSERT` without a reference now fails with a not-null violation.

**Files affected**

- `prisma/schema.prisma`, `prisma/migrations/20261030060104_stock_movement_reference_required/migration.sql` (new)
- `repositories/inventory.repository.ts`, `repositories/receiving-report.repository.ts`
- `services/inventory.service.ts` (new), `services/receiving-report.service.ts`
- `app/(protected)/inventory/ledger/page.tsx` (new), `app/(protected)/procurement/receiving/[id]/page.tsx`, `lib/navigation.ts`
- `docs/database.md`, `docs/architecture.md`, `docs/overview.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

**Database changes**

Migration `20261030060104_stock_movement_reference_required`: `ALTER COLUMN "referenceId" SET
NOT NULL, ALTER COLUMN "referenceType" SET NOT NULL` on `StockMovement`. Checked first: 1 row,
both set. On a table with null references it would need a backfill before tightening. Drift
check: empty. The signed-quantity rule is documented, not enforced by a `CHECK` — a constraint
cannot say "IN is positive" while `TRANSFER` goes either way — so it lives in
`InventoryRepository` and the reconciliation check.

**API changes**

None — the ledger is a Server Component reading through `InventoryService`.

**UI changes**

New Stock Ledger page and sidebar link. RR page Stock card rows link into it.

**How to verify**

```bash
npx tsc --noEmit && npm run lint
npm run build        # stop `npm run dev` first; it clobbers .next
```

Open Stock Ledger: RR-000001's `+4 kg` Pork Belly row, its source a link for admin /
procurement / accounting and plain text for the other roles. Filter to Pork Belly + Main
Commissary: Balance 4 kg and "✓ Ledger 4 kg = stock level 4 kg". From RR-000001's Stock card,
the row opens that same filtered view.

**Risks / assumptions / follow-up**

- Signed quantities depend on writers; the reconciliation check is the safety net, and only
  when someone looks. A scheduled reconciliation (alongside Task 7's low-stock job) would make
  it automatic.
- The ledger has no date filter yet; paging is enough at today's volume.
- Material and branch pickers list active ones only; a deactivated material's history is
  reachable only through a URL or an RR's Stock card.
- No branch isolation: a branch manager sees every branch's ledger, as with every other page.
