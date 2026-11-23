# API

Every endpoint is a Next.js route handler under `app/api/`. Shape: validate with `zod` → call a service → map the service's `{ success, data | error, status }` to a response. See [architecture.md](architecture.md) and [coding-conventions.md](coding-conventions.md#error-handling).

The browser is the only client. Server Components read through services directly and do not call these endpoints.

## Conventions

* **Auth**: the `kitchen-token` cookie (set by `POST /api/auth/login`). `middleware.ts` verifies it on every non-public path; without it, the request is redirected to `/login` (a `307`, not a `401` — route handlers never see an unauthenticated request).
* **Roles**: `ROLE_GUARDS` in `middleware.ts` restricts path prefixes, optionally only for some HTTP methods. A role outside the guard is redirected to `/unauthorized` (`307`). Services add action-level checks (`403`) where one path serves several roles. All guards that match a path apply.
* **Identity**: handlers that record *who* read `x-user-id` / `x-user-role` (injected by middleware) and return `401` if they are missing. Who did something is never taken from the body.
* **Bodies** are JSON. Quantities and money are **decimal strings** (`"2.5"`, regex-validated), never numbers. Dates are `YYYY-MM-DD`.
* **Success**: `200` with `{ <resource>: … }`, `201` on create. Lists return `{ <resources>: [...], total }`.
* **Errors**: `{ error: string }`; zod failures return `400` with `{ error: 'Validation failed', fields: fieldErrors }` (login returns a bare `{ error: 'Invalid input' }`). `400` bad input or a broken rule · `401` no identity · `403` role/ownership/self-approval · `404` not found · `409` wrong state · `500` `"Internal server error"` (details only in the server log, prefixed `[METHOD /path]`).
* **Pagination**: list endpoints take `skip` (≥ 0) and `take` (1–100, default 50).

## Guards

| Prefix | Methods | Roles |
|---|---|---|
| `/api/auth/login` | all | public |
| `/api/auth/register` | all | ADMIN |
| `/api/purchase-requests` | all | ADMIN, PROCUREMENT_MANAGER, BRANCH_MANAGER, PRODUCTION_MANAGER, ACCOUNTING |
| `/api/purchase-orders` | all | ADMIN, PROCUREMENT_MANAGER, ACCOUNTING |
| `/api/approvals` | all | ADMIN, ACCOUNTING |
| `/api/receiving-reports` | all | ADMIN, PROCUREMENT_MANAGER |
| `/api/production-orders` | all | ADMIN, PRODUCTION_MANAGER (accounting decides through `/api/approvals`) |
| `/api/conversion-orders` | all | ADMIN, PRODUCTION_MANAGER (accounting decides through `/api/approvals`) |
| `/api/write-offs` | all | ADMIN, PRODUCTION_MANAGER (accounting decides through `/api/approvals`) |
| `/api/stock-requests` (incl. `/[id]/plan`, `/[id]/decline`) | all | ADMIN, PRODUCTION_MANAGER, BRANCH_MANAGER — creating re-checks ADMIN / BRANCH_MANAGER (and the outlet) in the service, planning and declining ADMIN / PRODUCTION_MANAGER |
| `/api/transfers` (incl. `/preview`, `/returns`, `/[id]/receive`) | all | ADMIN, PRODUCTION_MANAGER, BRANCH_MANAGER — creating and previewing a delivery re-check ADMIN / PRODUCTION_MANAGER in the route (403); `/returns` and `?kind=return` re-check ADMIN / BRANCH_MANAGER, the service the outlet; receiving checks the branch (a return: production) in the service |
| `/api/ai/test` | all | ADMIN — spends real money; each AI feature's endpoint gets its own guard |
| `/api/materials` (incl. `/prices`), `/api/finished-goods`, `/api/categories`, `/api/units` | POST, PUT, PATCH, DELETE | ADMIN |
| `/api/boms` | POST, PUT, PATCH, DELETE | ADMIN, PRODUCTION_MANAGER |
| `/api/branches` (incl. `/deactivate`, `/reactivate`) | POST, PUT, PATCH, DELETE | ADMIN |
| everything else (incl. `/api/notifications`), and reads of the item master, BOMs and branches | GET | any signed-in user |

## Auth

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/api/auth/login` | `email`, `password` | 200 `{ user }` + sets cookie | 400, 401 invalid credentials |
| POST | `/api/auth/logout` | — | 200 `{ success: true }`, clears cookie | — |
| GET | `/api/auth/me` | — | 200 `{ user }` | 401, 404 user deleted |
| POST | `/api/auth/register` | `email`, `name`, `password` (8–100), `role`, `branchId?` | 201 `{ user }` — ADMIN only; no page calls it yet (planned `/admin/users`) | 400, 409 email taken |

## Item master

| Method | Path | Body / query | Success | Errors |
|---|---|---|---|---|
| GET | `/api/materials` | `search?`, `categoryId?`, `includeInactive?`, `skip?`, `take?` | 200 `{ materials, total }` (each with its current reference price) | 400 |
| POST | `/api/materials` | `code`, `name`, `description?`, `categoryId`, `unitId`, `reorderPoint` | 201 `{ material }` | 400, 409 duplicate code |
| GET | `/api/materials/[id]` | — | 200 `{ material }` | 404 |
| PATCH | `/api/materials/[id]` | any of `name`, `description`, `categoryId`, `unitId`, `reorderPoint`, `isActive` | 200 `{ material }` | 400, 404 |
| DELETE | `/api/materials/[id]` | — (soft: sets `isActive = false`) | 200 `{ material }` | 404 |
| GET | `/api/materials/[id]/prices` | — | 200 `{ prices }` newest first | 404 |
| POST | `/api/materials/[id]/prices` | `unitPrice`, `effectiveDate` (date or ISO datetime; back-dating allowed), `supplierId?`, `note?` | 201 `{ price }` | 400, 404 |
| GET | `/api/finished-goods` | `search?`, `categoryId?`, `includeInactive?`, `skip?`, `take?` | 200 `{ finishedGoods, total }` | 400 |
| POST | `/api/finished-goods` | `code`, `name`, `description?`, `categoryId`, `unitId`, `sellingPrice`, `shelfLifeHours?` (integer 1–720 or null) | 201 `{ finishedGood }` | 400, 409 |
| GET | `/api/finished-goods/[id]` | — | 200 `{ finishedGood }` | 404 |
| PATCH | `/api/finished-goods/[id]` | any of `name`, `description`, `categoryId`, `unitId`, `sellingPrice`, `shelfLifeHours` (integer 1–720; `null` clears it), `isActive` | 200 `{ finishedGood }` | 400, 404 |
| DELETE | `/api/finished-goods/[id]` | — (soft) | 200 `{ finishedGood }` | 404 |
| GET | `/api/finished-goods/[id]/bom-versions` | — | 200 `{ versions }`, every kind, each with its `kind` | 404 |
| GET | `/api/categories` | `type?` (`RAW_MATERIAL` · `FINISHED_GOOD` · `PACKAGING`) | 200 `{ categories }` | 400 |
| POST | `/api/categories` | `name`, `type` | 201 `{ category }` | 400, 409 |
| GET | `/api/units` | — | 200 `{ units }` | — |
| POST | `/api/units` | `name`, `abbreviation` | 201 `{ unit }` | 400, 409 |

## Branches

Week 8 Task 1. Managed from Master Data → Branches. A branch is `{ id, code, name, type, address, phone, manager: { id, name, email } | null, isActive }`.

| Method | Path | Body / query | Success | Errors |
|---|---|---|---|---|
| GET | `/api/branches` | `includeInactive?` (`true` · `false`, default `false`) | 200 `{ branches }`, oldest first | 400 |
| POST | `/api/branches` | `code` (trimmed, upper-cased, 2–10 letters/digits), `name` (2–100), `type` (`COMMISSARY` · `OUTLET`), `address?` (≤ 300), `phone?` (≤ 30; digits, spaces, `+ - ( )`), `managerId?` (a `BRANCH_MANAGER` user or null) | 201 `{ branch }` | 400 incl. not a branch manager, 409 code or name taken (name ignoring case), 409 manager just assigned elsewhere |
| PATCH | `/api/branches/[id]` | any of `name`, `type`, `address`, `phone`, `managerId` (`null` clears; omitted leaves it). `code` cannot change — ignored if sent | 200 `{ branch }`; a manager running another branch is moved here | 400, 404, 409 name taken, 409 the only active commissary → outlet |
| POST | `/api/branches/[id]/deactivate` | — | 200 `{ branch }` with `isActive: false` | 404, 409 already inactive, 409 holds stock / has open documents (the message counts them and names up to 3 document numbers each), 409 the only active commissary |
| POST | `/api/branches/[id]/reactivate` | — | 200 `{ branch }` | 404, 409 already active |

## BOM

| Method | Path | Body / query | Success | Errors |
|---|---|---|---|---|
| GET | `/api/boms` | `finishedGoodId?`, `kind?` (`PRODUCTION` · `CONVERSION`), `includeSuperseded?`, `skip?`, `take?` | 200 `{ boms, total }`, each with `kind` and `source` (`{ name, quantity, unitAbbreviation }` or null) | 400 |
| POST | `/api/boms` | `finishedGoodId`, `kind?` (default `PRODUCTION`), `sourceFinishedGoodId?` + `sourceQuantity?` (`CONVERSION` only, both required), `batchSize`, `batchUnitId`, `notes?`, `items[]` of `materialId`, `quantity`, `unitId`, `notes?` (≥ 1) | 201 `{ bom }` — a new active version of that kind; the previous version **of the same kind** is superseded | 400, 404 |
| GET | `/api/boms/[id]` | `targetQuantity?` (scales every line, and a conversion's source) | 200 `{ bom }` with `kind` and `source` (`{ finishedGoodId, code, name, unitAbbreviation, batchQuantity, scaledQuantity }` or null); a conversion's `totalCost` is its added ingredients only | 400, 404 |

Conversion BOMs (Week 7 Task 1): a `CONVERSION` recipe names the finished good it converts and how much of it one batch uses; it must not be its own source, the source must be active, `sourceQuantity` > 0, and the batch must be stated in the output's own unit. A `PRODUCTION` recipe sends neither source field (400). Versions are numbered per kind. There is no BOM editor in the UI; recipes are entered through this endpoint.

## Purchase requests

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/api/purchase-requests` | `deliverToId` (the kitchen the materials are for: an active central kitchen — required since Week 10 Task 4), `notes?`, `neededBy?`, `items[]` of `materialId`, `quantity`, `estimatedUnitCost?`, `notes?` (≥ 1) | 201 `{ purchaseRequest }` as `DRAFT`, numbered `PR-000001`; the detail carries `deliverTo { id, name } \| null` (null only on old requests) | 400 (incl. a missing kitchen or an outlet), 401 |
| POST | `/api/purchase-requests/[id]/submit` | — | 200 `{ purchaseRequest }` → `PENDING_APPROVAL`; enqueues the approver notification | 401, 403 not the requester (ADMIN excepted), 404, 409 not a draft |

## Purchase orders

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| PATCH | `/api/purchase-orders/[id]` | `supplierId?`, `expectedDelivery?`, `notes?` (choosing a supplier re-prices every line) | 200 `{ purchaseOrder }` | 400 incl. unknown supplier, 401, 403 not procurement, 404, 409 not a draft |
| POST | `/api/purchase-orders/[id]/submit` | — | 200 `{ purchaseOrder }` → `PENDING_APPROVAL`, records `submittedById` | 400 no supplier yet, 401, 403, 404, 409 not a draft |
| POST | `/api/purchase-orders/[id]/send` | — | 200 `{ purchaseOrder }` → `SENT` (a status flip; no email) | 401, 403, 404, 409 not approved |
| GET | `/api/purchase-orders/[id]/pdf` | — | 200 `application/pdf`, inline, `<poNumber>.pdf` | 401, 404, 409 not approved or sent |

## Approvals

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/api/approvals` | `referenceType` (`PurchaseRequest` · `PurchaseOrder` · `ReceivingReport` · `ProductionOrder` · `ProductionCompletion` · `ConversionOrder` · `WriteOff` · `StockTransfer`), `referenceId`, `decision` (`APPROVED` · `REJECTED`), `remarks?` (required to reject) | 200 `{ purchaseRequest }`, `{ purchaseOrder }`, `{ receivingReport: { id, rrNumber } }`, `{ productionOrder: { id, orderNumber } }`, `{ conversionOrder: { id, orderNumber } }`, `{ writeOff: { id, writeOffNumber } }` or `{ transfer }` | 400, 401, 403 own submission / own count, 404, 409 already decided (also when another approver decided it a moment earlier) |

The one endpoint for every approve/reject decision — the Approvals inbox (`/procurement/approvals`, Week 11 Task 1) posts each row's Approve / Reject here. The `referenceType` list is `APPROVAL_TYPES` in `services/approval-inbox.service.ts`, shared by the route's zod schema and the inbox. Every type moves its status with the expected status in the `WHERE`, so two approvers deciding the same document at once get one 200 and one 409 (purchase requests since Week 11 Task 1; the others already did). Approving a request also creates its draft purchase order and moves the request to `CONVERTED_TO_PO`, in one transaction. A receiving report cannot be decided by whoever counted it (`receivedById`). Approving one also posts its stock and moves the order to `PARTIALLY_RECEIVED` / `FULLY_RECEIVED`, in one transaction under a lock on the order; it returns 409 and changes nothing if the order can no longer take a delivery or a line would end up received beyond what was ordered. A production order cannot be decided by whoever submitted it (`submittedById`); the decision and its `Approval` row are written in one transaction, and the submitter (and, on approval with shortages, procurement) is notified through the queue.

`ProductionCompletion` (referenceId = the production order) decides a run the kitchen reported done (`PENDING_COMPLETION`). Never by whoever reported it (`completedById`, 403), ADMIN included; a reason is required to reject. **Approve** → `COMPLETED`, and in the same transaction: the run's cost (`plannedCost`, `actualCost`, `costPerUnit`, `costVariance`, see [database.md](database.md)), one `OUT` stock movement per ingredient of the pinned BOM at the planned quantity with the price used as `unitCost` (stock may go negative), and the actual yield into finished-goods stock as a new lot numbered after the order, at the cost per unit. 409 naming each material and date if a reference price is missing, or naming the finished good if it has no shelf life (an admin sets it, then approve). The lot's expiry is the moment the run was reported done + the shelf life. **Reject** → back to `IN_PROGRESS`, clearing the reported yield. 409 if the order is not awaiting a completion decision, or the report changed meanwhile (sent back and re-reported). Returns `{ productionOrder: { id, orderNumber } }`. Whoever reported it is notified through the queue; reporting notifies the approvers.

`ConversionOrder` decides a recorded conversion (`PENDING_APPROVAL`). Never by whoever recorded it (`submittedById`, 403), ADMIN included; a reason is required to reject, and `REJECTED` is final. **Approve** → `APPROVED`, in one transaction: the source taken from its lots at the branch, soonest expiry first with expired lots skipped, each at the lot's recorded cost; the added ingredients out of material stock at reference prices on the conversion date (may go negative); the output in as a new lot numbered after the order, expiring its shelf life after the conversion was recorded; `sourceCost`, `conversionCost`, `costPerUnit` recorded. 409 if the output has no shelf life, an ingredient has no reference price on the conversion date (each named), or the unexpired source on hand no longer covers it — all before anything is written. 409 if already decided. Whoever recorded it is notified through the queue.

`StockTransfer` decides a recorded transfer (`PENDING_APPROVAL`, Week 8 Task 3). Never by whoever recorded it (`submittedById`, 403), ADMIN included; a reason is required to reject, and `REJECTED` is final. **Approve** → `APPROVED` (dispatched), in one transaction: each line's lots at the sender are locked and re-planned soonest expiry first, expired skipped; any line short → 409 naming every short line, nothing written; else one `TRANSFER` (−) movement per lot at its cost. 200 `{ transfer: { id, transferNumber, status } }`. Queues the decided notification.

`WriteOff` decides a recorded write-off (`PENDING_APPROVAL`). Never by whoever recorded it (`submittedById`, 403), ADMIN included; a reason is required to reject, and `REJECTED` is final. **Approve** → `APPROVED`, in one transaction: the lot is locked and rechecked, then one `WASTE` movement takes the quantity out at the lot's recorded cost, and `unitCost` / `totalCost` are recorded. 409 if the lot no longer holds the quantity or has no recorded cost (nothing written), or if already decided. Whoever recorded it is notified through the queue.

## Receiving reports

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/api/receiving-reports` | `purchaseOrderId`, `branchId`, `receivedAt`, `notes?`, `items[]` of `purchaseOrderItemId`, `receivedQuantity`, `rejectedQuantity`, `notes?` — one per PO line | 201 `{ receivingReport: { id, rrNumber } }` as `DRAFT` | 400 counts/branch/date, 401, 403, 404 order, 409 order not receivable / another RR open |
| PATCH | `/api/receiving-reports/[id]` | the same minus `purchaseOrderId` | 200 `{ receivingReport: { id, rrNumber } }`; the caller becomes `receivedById` | 400, 401, 403, 404, 409 not a draft / changed meanwhile |
| POST | `/api/receiving-reports/[id]/submit` | — | 200 `{ receivingReport: { id, rrNumber } }` → `PENDING_APPROVAL`; `receivedById` unchanged | 400 saved counts break a rule (edit and save first), 401, 403, 404, 409 not a draft |

Rules (create, edit, and re-checked on submit): the order is `SENT` or `PARTIALLY_RECEIVED`; every PO line counted once; rejected ≤ received; received − rejected ≤ outstanding; a line with rejected > 0 has a line note; date not after today (Asia/Manila); not every line zero. Outstanding at save time is stored as each line's `expectedQuantity`, which variance is measured against.

## Production orders

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/api/production-orders` | `finishedGoodId`, `batchWeight` (decimal string), `batchCount` (JSON integer 1–100), `plannedDate`, `branchId`, `notes?` | 201 `{ productionOrder: { id, orderNumber } }` as `DRAFT`, numbered `PRD-000001` | 400, 401, 403 |
| PATCH | `/api/production-orders/[id]` | the same fields | 200 `{ productionOrder: { id, orderNumber } }` | 400, 401, 403, 404, 409 not a draft / changed meanwhile |
| POST | `/api/production-orders/[id]/start` | — | 200 `{ productionOrder: { id, orderNumber } }` → `IN_PROGRESS`; logged | 401, 403, 404, 409 not approved / changed meanwhile |
| POST | `/api/production-orders/[id]/complete` | `actualQty` (decimal string) | 200 `{ productionOrder: { id, orderNumber } }` → `PENDING_COMPLETION`; records `actualQty`, `completedAt`, `completedById`; logged; no stock moves | 400 yield 0 or more than 2 × planned, 401, 403, 404, 409 not in progress / already reported / changed meanwhile |
| POST | `/api/production-orders/[id]/cancel` | `reason` (1–500, required) | 200 `{ productionOrder: { id, orderNumber } }` → `CANCELLED`; reason logged | 400 no reason, 401, 403, 404, 409 in progress / already decided-out / changed meanwhile |
| POST | `/api/production-orders/[id]/submit` | — | 200 `{ productionOrder: { id, orderNumber } }` → `PENDING_APPROVAL`, records `submittedById`; queues the approver notification | 400 saved draft breaks a rule (e.g. past date — edit and save first), 401, 403, 404, 409 not a draft / BOM pin superseded / changed meanwhile |
| GET | `/api/production-orders/requirements` | query `finishedGoodId`, `batchWeight` (decimal string), `batchCount` (integer 1–100), `branchId` | 200 `{ requirements: { bomId, bomVersion, batchWeight, batchCount, plannedQty, branchName, lines: [{ materialId, materialCode, materialName, unitAbbreviation, perBatch, total, stock: { onHand, committed, available, short, enough } }] } }` — the **active** BOM (what a save would pin) scaled per batch and in total, with the stock check at `branchId` | 400 incl. weight 0 and unknown / inactive branch, 404 no active BOM |

Rules (create and edit): the finished good is active and has an active BOM; the BOM's batch unit equals the finished good's unit (no unit conversion yet); batch weight > 0; the branch is active; the date is not before today (Asia/Manila). The server pins `bomId` to the active version on every save, computes `plannedQty` = `batchWeight × batchCount` in Decimal, and takes `requestedById` from the caller on create only — an edit by someone else keeps the original requester. The pages read through `ProductionOrderService`. `GET …/requirements` is the form's live preview and writes nothing; the order page computes the same lines from the **pinned** BOM. Stock check (both): `onHand` at the branch now; `committed` = what other `APPROVED` / `IN_PROGRESS` / `PENDING_COMPLETION` orders at that branch still need (stock leaves only when accounting approves a completion); `available` = on hand − committed (may be negative); `short` = max(required − max(available, 0), 0) — never more than this order's own requirement; `enough` = required ≤ available. Expected deliveries are not counted. On the order page `stock` is null for `COMPLETED`, `REJECTED` and `CANCELLED` orders.

## Conversion orders

| Method | Path | Body / query | Success | Errors |
|---|---|---|---|---|
| POST | `/api/conversion-orders` | `bomId` (an active `CONVERSION` BOM), `branchId`, `sourceQty`, `outputQty` (decimal strings), `notes?` | 201 `{ conversionOrder: { id, orderNumber } }` created `PENDING_APPROVAL` — recorded and submitted in one step, numbered `CNV-000001`; queues the approver notification | 400 incl. quantities ≤ 0, output > 2 × what the recipe expects, not enough unexpired source, unknown recipe / branch; 401; 403; 409 the recipe version was superseded |
| GET | `/api/conversion-orders/preview` | query `bomId`, `branchId`, `sourceQty?`, `outputQty?` | 200 `{ preview: { bomId, bomVersion, effect } }` — `effect`: the source (`unexpiredOnHand`, `expiredOnHand`, `pending`, `available`, `enough`, `lots[]` with `take` and `unitCost`), the added `ingredients[]` (`deduct`, `onHand`, `after`, `goesNegative`, `unitPrice`), `cost` (`sourceCost`, `conversionCost`, `missing[]`, `total`, `perUnit`, `pricedOn`) and `output` (`expected`, `percentOfExpected`, `expiresAt`) | 400, 409 superseded recipe |

Rules: the recipe's output is active; the branch is active; `sourceQty` > 0 and ≤ the source's unexpired stock at the branch less what other pending conversions, pending write-offs of unexpired lots and pending transfers from the branch have claimed; `outputQty` > 0 and ≤ 2 × `batchSize × sourceQty ÷ sourceQuantity`. The submitter is the caller. The pages (`/production/conversions`, `/new`, `/[id]`) read through `ConversionOrderService`; accounting reads them but `/production/conversions/new` is ADMIN + PRODUCTION_MANAGER.

## Write-offs

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/api/write-offs` | `lotId`, `branchId`, `quantity` (decimal string), `reason` (`EXPIRED` · `SPOILED` · `DAMAGED` · `FAILED_QUALITY` · `OTHER`), `notes?` | 201 `{ writeOff: { id, writeOffNumber } }` created `PENDING_APPROVAL` — recorded and submitted in one step, numbered `WO-000001`; queues the approver notification | 400 quantity ≤ 0 or more than the lot has left (on hand − other pending write-offs of it), `OTHER` without notes, a lot with nothing at the branch, unknown branch; 401; 403 |

Finished-goods lots only. The submitter is the caller. The pages (`/inventory/write-offs`, `/new?lot=&branch=`, `/[id]`) read through `WriteOffService`; accounting reads them, `/inventory/write-offs/new` is ADMIN + PRODUCTION_MANAGER.

## Transfers

Week 8 Tasks 2–4. A Transfer Order sends finished goods from an active commissary to another active branch. Accounting's approval dispatches it (`POST /api/approvals`, above); the receiving branch counts what arrived, and any shortfall is recorded as lost in transit.

| Method | Path | Body / query | Success | Errors |
|---|---|---|---|---|
| POST | `/api/transfers` | `stockRequestId?` (Week 9 Task 10: a PLANNED request from this kitchen to this outlet, with no other open delivery — 409 / 400 otherwise; its receipt fulfils the request), `fromBranchId`, `toBranchId`, `notes?` (≤ 1000), `lines[]` (1–30) of `finishedGoodId`, `quantity` (decimal string) | 201 `{ transfer: { id, transferNumber } }` created `PENDING_APPROVAL` — recorded and submitted in one step, numbered `TRF-000001` | 400 sender not an active commissary, receiver inactive / unknown / the same branch, a good twice, quantity ≤ 0, unknown or inactive good; 409 a line over what the sender can send (every short line named, with on hand and claimed); 401 |
| POST | `/api/transfers/[id]/receive` | `lots[]` of `lotId`, `received` (decimal string, may be `0`) — one per dispatched lot; `reason?` (`DAMAGED` · `SPOILED` · `MISSING` · `OTHER`), `notes?` (≤ 1000) | 200 `{ transfer: { id, transferNumber, status: 'RECEIVED', varianceValue } }`: what arrived of each lot joins the receiver (same lot, `TRANSFER` +; none for 0), `receivedById` / `receivedAt` and the variance (value at lot cost, reason, notes — the reason is dropped when nothing is short) set; queues the received notification | 400 malformed body, a lot not on the transfer or counted twice, a dispatched lot not counted, received > sent ("a dispatch miscount"), short without a reason, `OTHER` without notes; 403 not the receiving branch's manager or an ADMIN (for a return: not PRODUCTION_MANAGER or ADMIN); 404 unknown, or a branch manager it does not concern; 409 pending ("nothing has been sent yet"), already received, rejected, or received by someone else at the same moment; 401 |
| POST | `/api/stock-requests` | `branchId` (the outlet), `kitchenId`, `neededOn` (YYYY-MM-DD), `notes?` (≤ 1000), `lines[]` (1–30) of `finishedGoodId`, `quantity` | 201 `{ stockRequest: { id, requestNumber, late } }` — `STR-000001`, SUBMITTED, Late if at/after `STOCK_REQUEST_CUTOFF` the day before (or on the day); queues the kitchen's notification (Week 9 Task 10) | 403 not ADMIN / BRANCH_MANAGER; 404 a branch manager naming an outlet they do not run; 400 not an active outlet, not an active kitchen, a past day, a good twice, quantity ≤ 0, unknown good; 401 |
| POST | `/api/stock-requests/[id]/plan` | `lines[]` of `itemId`, `plannedQuantity` (0 ≤ planned ≤ asked, every line), `note?` | 200 `{ stockRequest: { id, requestNumber, status: 'PLANNED' } }`; queues the outlet's notification | 403 not ADMIN / PRODUCTION_MANAGER; 404; 400 a line missing or out of range, a cut without a note, nothing planned ("decline it instead"); 409 already answered |
| POST | `/api/stock-requests/[id]/decline` | `reason` (required) | 200 `{ stockRequest: { id, requestNumber, status: 'DECLINED' } }`; queues the outlet's notification | 403; 404; 400 no reason; 409 already answered |
| POST | `/api/transfers/returns` | same body as `POST /api/transfers` (`fromBranchId` = the outlet, `toBranchId` = a kitchen) | 201 `{ transfer: { id, transferNumber } }` — a **return** (Week 9 Task 9), numbered `RTN-000001`, created `APPROVED` (in transit) and dispatched at once: no approval, lots soonest expiry first; queues the return-sent notification | 403 not ADMIN / BRANCH_MANAGER; 404 a branch manager naming a branch they do not run; 400 sender not an active outlet, receiver not an active kitchen, line rules as a transfer; 409 a line over what the outlet can send; 401 |
| GET | `/api/transfers/preview` | query `kind?` (`delivery` default, or `return` — then ADMIN / BRANCH_MANAGER and the sender must be the viewer's own outlet), `from` (branch id), `line` repeated: `<finishedGoodId>` or `<finishedGoodId>:<quantity>` | 200 `{ preview: { fromBranch, stock[], lines[], totalValue } }` — `stock`: every good with stock at the sender (+ any good on a line) with `unexpiredOnHand`, `expiredOnHand`, `claimed`, `available`; `lines` (those with a quantity): the same plus `required`, `enough`, `short`, `lots[]` (`lotNumber`, `expiresAt`, `expiry`, `take`, `unitCost`) soonest expiry first, `value` (null while short) | 400 sender not a commissary, malformed line |

What a line may take: the sender's unexpired stock of that good less what pending conversions, pending write-offs of its unexpired lots and other pending transfers from the branch have claimed. The submitter is the caller. Pages: `/inventory/transfers` (status, branch and arrival — `short=1`, arrived short — filters, a Short ₱X badge and the lost-in-transit total for the filters; a BRANCH_MANAGER sees only the branch they manage), `/inventory/transfers/new` (ADMIN, PRODUCTION_MANAGER), `/inventory/transfers/[id]` (404 for a branch manager it does not concern) — read through `StockTransferService`.

## Daily sales

Week 10 Task 1 (`docs/2026-11-22-week10-history-data.md`). What an outlet sold on a day, recorded at closing. No approval.

| Method | Path | Body / query | Success | Errors |
|---|---|---|---|---|
| POST | `/api/outlet-sales` | `branchId` (the outlet), `soldOn` (YYYY-MM-DD: today or yesterday, Manila), `notes?` (≤ 1000), `lines[]` (1–30) of `finishedGoodId`, `quantity` (decimal string) | 201 `{ sale: { id, saleNumber } }` — `SLS-000001`; the goods leave the outlet's lots soonest expiry first (never expired), each line priced at the good's selling price | Not ADMIN / BRANCH_MANAGER → middleware redirect to `/unauthorized`; 404 a branch manager naming an outlet they do not run; 400 a kitchen, another day, no lines, a good twice, quantity ≤ 0, unknown good; 409 more than the outlet has unexpired and unclaimed (each good named), or the day already recorded |

## Branch Inventory

Week 8 Task 5. The pages (`/inventory/branches`, `/inventory/branches/[code]`) read through `BranchInventoryService`; this is their live-update stream.

| Method | Path | Query | Success | Errors |
|---|---|---|---|---|
| GET | `/api/inventory/stream` | `branch?` (branch id) | 200 `text/event-stream`, held open: `retry: 5000`, an `event: inventory` (`data: {}`) whenever stock at that branch — or, with no `branch`, at any branch — moves, `: ping` every 25 s | 404 malformed or unknown id, an inactive branch, a BRANCH_MANAGER asking for another branch or for all; 401; 503 Redis unavailable |

Every signed-in role, no path guard; the access rule is the page's: every branch for every role except a BRANCH_MANAGER, who may watch only the branch in `Branch.managerId`. The event carries nothing — the page re-renders (`router.refresh()`) on it. Published after the commit by receiving-report approval, production-completion approval, conversion approval, write-off recorded / decided and transfer recorded / decided / received.

## Costing

Week 8 Task 6. No endpoint: `/costing` is a Server Component that reads `CostingService.dashboard(range, viewer)`
directly, and nothing on it writes. Guarded in `middleware.ts` to ADMIN, ACCOUNTING, PRODUCTION_MANAGER and VIEWER
(others → `/unauthorized`). Query `weeks` = 4, 12 (default), 26 or 52; anything else falls back to 12.

## AI

Week 9 Task 1. Every AI call goes through `AiService.complete()` (see `docs/2026-11-18-week9-claude-api-integration.md`), which records an `AiCall` row for each one. `/admin/ai` (AI Settings) is a Server Component reading `AiService.overview()`; this is its one endpoint.

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/api/ai/test` | `{ message }` — 1–500 characters after trimming | 200 `{ completion: { text, servedModel, inputTokens, outputTokens, costUsd, durationMs } }` — one real call as `CONNECTION_TEST`, `costUsd` an estimate in USD | 400 validation, or Claude declined (refusal) · 429 this month's AI budget is used up, or Anthropic rate-limited · 502 the API key was rejected, the answer was cut off at max tokens, or another API error (the API's own message is on AI Settings) · 503 not set up (no `ANTHROPIC_API_KEY`), unreachable, overloaded or timed out |

ADMIN only (middleware). The caller is the `x-user-id`. Every attempt that reaches the budget check is recorded, including `OVER_BUDGET`; "not set up" is not, since nothing was attempted. AI error statuses follow one table for every AI endpoint: 429 and 503 are worth retrying later, 502 needs an admin.

### Cost Variance Explainer

Week 9 Task 2 (see `docs/2026-11-19-week9-cost-variance-explainer.md`). The explanation is written by a background job (`cost-variance-explain` on the `ai` queue), queued automatically when accounting approves a completion; the order page reads the comparison and the stored `AiInsight` directly. This endpoint only asks for one.

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/api/ai/insights` | `{ type: 'COST_VARIANCE', referenceId: productionOrderId, regenerate? }` — the generic insight endpoint (Week 10 Task 2; it replaced `/api/ai/cost-variance`) | see **AI insights** below | see below |

ADMIN, PRODUCTION_MANAGER, ACCOUNTING (middleware) — the roles that can open production orders. The caller (`x-user-id`) is recorded on the `AiCall`. AI failures (not set up, over budget, refused, …) are not returned here: the job stores them on the insight and the card shows them with Try again.

### AI insights (Ask, Regenerate) and the Waste Pattern Detector

Week 10 Task 2 (see `docs/2026-11-23-week10-waste-pattern-detector.md`). One endpoint asks for any stored AI insight or regenerates it; `AiInsightService` holds, per type, who may ask and how. It only queues the job — the page shows the insight being written and refreshes.

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/api/ai/insights` | `type` (`COST_VARIANCE` · `WASTE_PATTERN` · `SUPPLIER_PERFORMANCE` · `REORDER_RECOMMENDATION` · `DEMAND_FORECAST`), `referenceId` (a production order id, an ISO week such as `2026-W48`, a month such as `2026-10` that has ended, a stock position `<branchId>:<materialId>`, or a kitchen and day `<kitchenId>:<YYYY-MM-DD>`), `regenerate?` (rewrite a written one; the earlier text stays until the new one is ready) | 200 `{ queued: true }`; 200 `{ queued: false }` — already being written, already written (without `regenerate`), or not written yet (with `regenerate`): nothing queued, nothing spent | 400 validation, unknown type, unknown week, a week not started; 403 the type's roles (`COST_VARIANCE` and `WASTE_PATTERN`: ADMIN, ACCOUNTING, PRODUCTION_MANAGER; `SUPPLIER_PERFORMANCE`: ADMIN, ACCOUNTING, PROCUREMENT_MANAGER; `REORDER_RECOMMENDATION`: ADMIN, PROCUREMENT_MANAGER, PRODUCTION_MANAGER; `DEMAND_FORECAST`: ADMIN, PRODUCTION_MANAGER); 404 unknown order; 409 an order not completed and costed, or a stock position that is not a kitchen material at or below its reorder point (400 if malformed) |

Guard: ADMIN, ACCOUNTING, PRODUCTION_MANAGER, PROCUREMENT_MANAGER (others → `/unauthorized`). The monthly supplier review is also asked for by `supplier-performance-monthly` (the 1st, 06:00).

Purchase orders carry the kitchen too (`deliverTo { id, name, address }` in the detail and on the PDF), copied from the request when it is approved. The receiving form starts on it.

The Reorder Recommender (Week 10 Task 4, `docs/2026-11-23-week10-reorder-recommender.md`) has no endpoint of its own: Stock Levels and Branch Inventory compute it in the Server Component (`ReorderService.forAlerts`), and `/procurement/requests/new?reorder=<branchId>:<materialId>` pre-fills the purchase request form from it (worked out again when it opens; an unknown or covered position gives the empty form).

### Suppliers

Week 10 Task 3. Master Data → Suppliers (a Server Component reading `SupplierService.list()`).

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| PATCH | `/api/suppliers/[id]` | `{ leadTimeDays: 1–60 \| null }` — the promised lead time in whole days; null clears it | 200 `{ supplier: { id, leadTimeDays } }` | 400 validation; 404 unknown supplier |

ADMIN only (middleware). The caller is recorded on the `AiCall`. The weekly waste report is also asked for by the clock job `waste-pattern-weekly` (Mondays 06:00), recorded as a background call. The dashboard reads the report in a Server Component (`WastePatternService.dashboard`), no endpoint.

### Holidays

Week 10 Task 5 (`docs/2026-11-23-week10-demand-forecaster.md`). Master Data → Holidays (a Server Component reading `HolidayService.list(year)`); the Demand Forecaster reads them through `HolidayService.between`.

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/api/holidays` | `{ date: YYYY-MM-DD, name: 1–100 chars, type: REGULAR \| SPECIAL_NON_WORKING \| SPECIAL_WORKING \| LOCAL }` | 201 `{ holiday: { id, date, name, type } }` | 400 validation; 409 the date already has a holiday |
| PATCH | `/api/holidays/[id]` | same | 200 `{ holiday }` | 400; 404; 409 the new date is taken |
| DELETE | `/api/holidays/[id]` | — | 200 `{ id }` | 404 |

### Decision Simulator

Week 10 Task 6 (`docs/2026-11-23-week10-decision-simulator.md`). Production → Plan's "Simulate a run".

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/api/production/simulate` | `{ kitchenId, date: YYYY-MM-DD (today … +14), lines: [{ finishedGoodId, batches: 1–50 }] (1–8, each good once), explain? }` | 200 `{ simulation: { kitchen, date, lines[], ingredients[], totals, feasible }, explanation: { text, model, costUsd } \| null, explainError? }` — writes nothing; with `explain`, one `DECISION_SIMULATOR` AiCall against the caller | 400 validation, an outlet, a day outside the window, a good twice or without an active recipe, extra fields; 403 `explain` for a role outside ADMIN, PRODUCTION_MANAGER, ACCOUNTING |

Guard: ADMIN, PRODUCTION_MANAGER, ACCOUNTING (middleware).

ADMIN only (middleware). Production → Plan (Feature 5) has no endpoint of its own: `DemandForecastService.forecast(kitchenId, date)` in the Server Component; its explanation is `POST /api/ai/insights` with `type: 'DEMAND_FORECAST'`, `referenceId: '<kitchenId>:<YYYY-MM-DD>'` (ADMIN, PRODUCTION_MANAGER; 409 for an inactive kitchen, a day outside today … +14 or nothing to plan).

### Dashboard assistant

Week 9 Task 3 (see `docs/2026-11-19-week9-nl-query.md`). One question per request; the page keeps the conversation and sends it back.

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/api/ai/assistant` | `{ messages: [{ role: 'user' \| 'assistant', content }], conversationId? }` — 1–7 messages, each 1–4,000 characters after trimming; the last is the question (`user`, at most 1,000); `conversationId` a uuid from the previous answer, or null / absent for a new conversation (Week 9 Task 4) | 200 `{ answer, lookups: [{ tool, label, query: { sql, rowCount, truncated } \| null }], costUsd, conversationId, action }` — `query` is set for `run_query` lookups ("How I got this"); `costUsd` covers every round; `action` is the document Claude drafted (Week 9 Task 5) or null: `{ id, type: 'PURCHASE_REQUEST' \| 'PRODUCTION_ORDER', status: 'PROPOSED' \| 'CONFIRMED' \| 'CANCELLED' \| 'EXPIRED', expiresAt, decidedAt, document: { number, href } \| null, draft }` |
| POST | `/api/ai/assistant/actions/[id]` | `{ decision: 'confirm' \| 'cancel' }` — `id` is the question's (`action.id`); the draft itself is read from the server | 200 `{ action }` — on confirm, the DRAFT document is created as the caller and `action.document` links it | 400 validation, or the document service refused it · 403 role cannot draft · 404 not found / not the caller's · 409 already confirmed, cancelled or being confirmed · 410 expired (24 h) · 422 draft unreadable — refusals also carry `{ action }` as it now stands | 400 validation, or Claude declined · 422 more than 5 rounds of lookups · 429 budget used up or rate limited · 502 key rejected, cut off or another API error · 503 not set up, unreachable or overloaded |

ADMIN, ACCOUNTING, PRODUCTION_MANAGER (middleware; others → `/unauthorized`). Each question is logged as an `AiQuery` (Week 9 Task 4; admins read it at `/admin/ai/questions`, a Server Component with no endpoint) and each round is one `ASSISTANT` `AiCall` against the caller (`x-user-id`) pointing at it. The tools offered depend on the role and on `AI_DATABASE_URL` (`run_query` only when it is set). The drafting tools and `/actions/[id]` are ADMIN and PRODUCTION_MANAGER only (checked in `AssistantActionService`; accounting reaches the route through the `/api/ai/assistant` guard and gets 403). Only the asker can decide their draft, once, within 24 hours (see `docs/2026-11-20-week9-ai-write-actions.md`).

## Notifications

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| GET | `/api/notifications` | — | 200 `{ unreadCount, notifications: [{ id, type, title, body, href, read, createdAt }] }` — the caller's latest 15, newest first | 401 |
| GET | `/api/notifications/stream` | — | 200 `text/event-stream`, held open: `retry: 5000`, an `event: notifications` (`data: {}`) whenever the caller's notifications change, `: ping` every 25 s | 401, 503 Redis unavailable |
| POST | `/api/notifications/read` | `{ id }` or `{ all: true }` | 200 `{ updated }` — how many of the caller's unread notifications were marked; 0 if already read or not theirs | 400, 401 |

Every signed-in user, no role guard: each call only ever touches the caller's own notifications (`x-user-id` in every `WHERE`). The stream's event carries nothing — the client reloads `GET /api/notifications` on it. `href` comes from `referenceType` (`PurchaseRequest` → the request, `ProductionOrder` → the order, `ProductionOrderShortfall` → `/procurement/requests/new?productionOrder=<id>`, `ConversionOrder` → the conversion, `WriteOff` → the write-off, `LowStockCheck` → `/inventory/stock`, `StockReconciliation` → `/inventory/ledger`, `ExpiryCheck` → `/inventory/finished-goods`, `EndOfDaySummary` → `/inventory/end-of-day?date=<the date>`), null when there is no page. Response shapes here are the DTO itself rather than `{ <resource>: … }`.

## Known gaps

None open. Fixed 2026-10-30 (see `docs/2026-10-30-api-guards.md`): public registration with a caller-chosen role, unguarded item-master and BOM writes, and boolean query parameters that read `"false"` as true.

Boolean query parameters (`includeInactive`, `includeSuperseded`) accept exactly `true` or `false`; anything else is a 400.
