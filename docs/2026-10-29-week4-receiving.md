# Week 4 — Receiving Report & Stock Update

Delivered task by task. This note is appended to as each lands.

## Design decisions settled before building

| Area | Decision | Rationale |
|---|---|---|
| Stock location | `ReceivingReport.branchId` required. A "Main Commissary" branch is seeded and is the form's default. | Stock is per `materialId` + `branchId` (`InventoryLevel`'s unique key), so a delivery has to land somewhere specific. Real branch names were not supplied; the seed gives one to receive into. |
| Ledger location | `StockMovement.branchId` required | A movement without a branch cannot be replayed against `InventoryLevel`. Added now, while the table is empty, rather than backfilled later. |
| RR lifecycle | `RRStatus` = `DRAFT → PENDING_APPROVAL → APPROVED \| REJECTED`. `CONFIRMED` and `DISCREPANCY_FLAGGED` dropped. | The same shape as PR and PO, so `POST /api/approvals` and the shared components fit. A discrepancy is a property of the lines, not a status. |
| Variance | Derived from the lines, never stored | Ordered, received and rejected are all on the line; a stored flag could disagree with them. |
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
| `orderedQuantity` on the RR line | The PO line's quantity, not the outstanding at the time | It is what the order said. Revisit in Task 2 if variance should be measured against outstanding. |
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
