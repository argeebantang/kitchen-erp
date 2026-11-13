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
| `/api/materials` (incl. `/prices`), `/api/finished-goods`, `/api/categories`, `/api/units` | POST, PUT, PATCH, DELETE | ADMIN |
| `/api/boms` | POST, PUT, PATCH, DELETE | ADMIN, PRODUCTION_MANAGER |
| everything else (incl. `/api/notifications`), and reads of the item master and BOMs | GET | any signed-in user |

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
| POST | `/api/purchase-requests` | `notes?`, `neededBy?`, `items[]` of `materialId`, `quantity`, `estimatedUnitCost?`, `notes?` (≥ 1) | 201 `{ purchaseRequest }` as `DRAFT`, numbered `PR-000001` | 400, 401 |
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
| POST | `/api/approvals` | `referenceType` (`PurchaseRequest` · `PurchaseOrder` · `ReceivingReport` · `ProductionOrder` · `ProductionCompletion` · `ConversionOrder` · `WriteOff`), `referenceId`, `decision` (`APPROVED` · `REJECTED`), `remarks?` (required to reject) | 200 `{ purchaseRequest }`, `{ purchaseOrder }`, `{ receivingReport: { id, rrNumber } }`, `{ productionOrder: { id, orderNumber } }`, `{ conversionOrder: { id, orderNumber } }` or `{ writeOff: { id, writeOffNumber } }` | 400, 401, 403 own submission / own count, 404, 409 already decided |

The one endpoint for every approve/reject decision. Approving a request also creates its draft purchase order and moves the request to `CONVERTED_TO_PO`, in one transaction. A receiving report cannot be decided by whoever counted it (`receivedById`). Approving one also posts its stock and moves the order to `PARTIALLY_RECEIVED` / `FULLY_RECEIVED`, in one transaction under a lock on the order; it returns 409 and changes nothing if the order can no longer take a delivery or a line would end up received beyond what was ordered. A production order cannot be decided by whoever submitted it (`submittedById`); the decision and its `Approval` row are written in one transaction, and the submitter (and, on approval with shortages, procurement) is notified through the queue.

`ProductionCompletion` (referenceId = the production order) decides a run the kitchen reported done (`PENDING_COMPLETION`). Never by whoever reported it (`completedById`, 403), ADMIN included; a reason is required to reject. **Approve** → `COMPLETED`, and in the same transaction: the run's cost (`plannedCost`, `actualCost`, `costPerUnit`, `costVariance`, see [database.md](database.md)), one `OUT` stock movement per ingredient of the pinned BOM at the planned quantity with the price used as `unitCost` (stock may go negative), and the actual yield into finished-goods stock as a new lot numbered after the order, at the cost per unit. 409 naming each material and date if a reference price is missing, or naming the finished good if it has no shelf life (an admin sets it, then approve). The lot's expiry is the moment the run was reported done + the shelf life. **Reject** → back to `IN_PROGRESS`, clearing the reported yield. 409 if the order is not awaiting a completion decision, or the report changed meanwhile (sent back and re-reported). Returns `{ productionOrder: { id, orderNumber } }`. Whoever reported it is notified through the queue; reporting notifies the approvers.

`ConversionOrder` decides a recorded conversion (`PENDING_APPROVAL`). Never by whoever recorded it (`submittedById`, 403), ADMIN included; a reason is required to reject, and `REJECTED` is final. **Approve** → `APPROVED`, in one transaction: the source taken from its lots at the branch, soonest expiry first with expired lots skipped, each at the lot's recorded cost; the added ingredients out of material stock at reference prices on the conversion date (may go negative); the output in as a new lot numbered after the order, expiring its shelf life after the conversion was recorded; `sourceCost`, `conversionCost`, `costPerUnit` recorded. 409 if the output has no shelf life, an ingredient has no reference price on the conversion date (each named), or the unexpired source on hand no longer covers it — all before anything is written. 409 if already decided. Whoever recorded it is notified through the queue.

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

Rules: the recipe's output is active; the branch is active; `sourceQty` > 0 and ≤ the source's unexpired stock at the branch less what other pending conversions there have claimed; `outputQty` > 0 and ≤ 2 × `batchSize × sourceQty ÷ sourceQuantity`. The submitter is the caller. The pages (`/production/conversions`, `/new`, `/[id]`) read through `ConversionOrderService`; accounting reads them but `/production/conversions/new` is ADMIN + PRODUCTION_MANAGER.

## Write-offs

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/api/write-offs` | `lotId`, `branchId`, `quantity` (decimal string), `reason` (`EXPIRED` · `SPOILED` · `DAMAGED` · `FAILED_QUALITY` · `OTHER`), `notes?` | 201 `{ writeOff: { id, writeOffNumber } }` created `PENDING_APPROVAL` — recorded and submitted in one step, numbered `WO-000001`; queues the approver notification | 400 quantity ≤ 0 or more than the lot has left (on hand − other pending write-offs of it), `OTHER` without notes, a lot with nothing at the branch, unknown branch; 401; 403 |

Finished-goods lots only. The submitter is the caller. The pages (`/inventory/write-offs`, `/new?lot=&branch=`, `/[id]`) read through `WriteOffService`; accounting reads them, `/inventory/write-offs/new` is ADMIN + PRODUCTION_MANAGER.

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
