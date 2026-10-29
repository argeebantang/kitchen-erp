# API

Every endpoint is a Next.js route handler under `app/api/`. Shape: validate with `zod` → call a service → map the service's `{ success, data | error, status }` to a response. See [architecture.md](architecture.md) and [coding-conventions.md](coding-conventions.md#error-handling).

The browser is the only client. Server Components read through services directly and do not call these endpoints.

## Conventions

* **Auth**: the `kitchen-token` cookie (set by `POST /api/auth/login`). `middleware.ts` verifies it on every non-public path; without it, the request is redirected to `/login` (a `307`, not a `401` — route handlers never see an unauthenticated request).
* **Roles**: `ROLE_GUARDS` in `middleware.ts` restricts path prefixes. A role outside the guard is redirected to `/unauthorized` (`307`). Services add action-level checks (`403`) where one path serves several roles. All guards that match a path apply.
* **Identity**: handlers that record *who* read `x-user-id` / `x-user-role` (injected by middleware) and return `401` if they are missing. Who did something is never taken from the body.
* **Bodies** are JSON. Quantities and money are **decimal strings** (`"2.5"`, regex-validated), never numbers. Dates are `YYYY-MM-DD`.
* **Success**: `200` with `{ <resource>: … }`, `201` on create. Lists return `{ <resources>: [...], total }`.
* **Errors**: `{ error: string }`; zod failures return `400` with `{ error: 'Validation failed', fields: fieldErrors }` (login returns a bare `{ error: 'Invalid input' }`). `400` bad input or a broken rule · `401` no identity · `403` role/ownership/self-approval · `404` not found · `409` wrong state · `500` `"Internal server error"` (details only in the server log, prefixed `[METHOD /path]`).
* **Pagination**: list endpoints take `skip` (≥ 0) and `take` (1–100, default 50).

## Guards

| Prefix | Roles |
|---|---|
| `/api/auth/login`, `/api/auth/register` | public |
| `/api/purchase-requests` | ADMIN, PROCUREMENT_MANAGER, BRANCH_MANAGER, PRODUCTION_MANAGER, ACCOUNTING |
| `/api/purchase-orders` | ADMIN, PROCUREMENT_MANAGER, ACCOUNTING |
| `/api/approvals` | ADMIN, ACCOUNTING |
| `/api/receiving-reports` | ADMIN, PROCUREMENT_MANAGER |
| everything else under `/api` | any signed-in user — see [Known gaps](#known-gaps) |

## Auth

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/api/auth/login` | `email`, `password` | 200 `{ user }` + sets cookie | 400, 401 invalid credentials |
| POST | `/api/auth/logout` | — | 200 `{ success: true }`, clears cookie | — |
| GET | `/api/auth/me` | — | 200 `{ user }` | 401, 404 user deleted |
| POST | `/api/auth/register` | `email`, `name`, `password` (8–100), `role`, `branchId?` | 201 `{ user }` | 400, 409 email taken |

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
| POST | `/api/finished-goods` | `code`, `name`, `description?`, `categoryId`, `unitId`, `sellingPrice` | 201 `{ finishedGood }` | 400, 409 |
| GET | `/api/finished-goods/[id]` | — | 200 `{ finishedGood }` | 404 |
| PATCH | `/api/finished-goods/[id]` | any of `name`, `description`, `categoryId`, `unitId`, `sellingPrice`, `isActive` | 200 `{ finishedGood }` | 400, 404 |
| DELETE | `/api/finished-goods/[id]` | — (soft) | 200 `{ finishedGood }` | 404 |
| GET | `/api/finished-goods/[id]/bom-versions` | — | 200 `{ versions }` | 404 |
| GET | `/api/categories` | `type?` (`RAW_MATERIAL` · `FINISHED_GOOD` · `PACKAGING`) | 200 `{ categories }` | 400 |
| POST | `/api/categories` | `name`, `type` | 201 `{ category }` | 400, 409 |
| GET | `/api/units` | — | 200 `{ units }` | — |
| POST | `/api/units` | `name`, `abbreviation` | 201 `{ unit }` | 400, 409 |

## BOM

| Method | Path | Body / query | Success | Errors |
|---|---|---|---|---|
| GET | `/api/boms` | `finishedGoodId?`, `includeSuperseded?`, `skip?`, `take?` | 200 `{ boms, total }` | 400 |
| POST | `/api/boms` | `finishedGoodId`, `batchSize`, `batchUnitId`, `notes?`, `items[]` of `materialId`, `quantity`, `unitId`, `notes?` (≥ 1) | 201 `{ bom }` — a new active version; the previous one is superseded | 400, 404 |
| GET | `/api/boms/[id]` | `targetQuantity?` (scales every line) | 200 `{ bom }` | 400, 404 |

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
| POST | `/api/approvals` | `referenceType` (`PurchaseRequest` · `PurchaseOrder`), `referenceId`, `decision` (`APPROVED` · `REJECTED`), `remarks?` (required to reject) | 200 `{ purchaseRequest }` or `{ purchaseOrder }` | 400, 401, 403 own submission, 404, 409 already decided |

The one endpoint for every approve/reject decision. Approving a request also creates its draft purchase order and moves the request to `CONVERTED_TO_PO`, in one transaction. `ReceivingReport` joins `referenceType` in Week 4 task 3.

## Receiving reports

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/api/receiving-reports` | `purchaseOrderId`, `branchId`, `receivedAt`, `notes?`, `items[]` of `purchaseOrderItemId`, `receivedQuantity`, `rejectedQuantity`, `notes?` — one per PO line | 201 `{ receivingReport: { id, rrNumber } }` as `DRAFT` | 400 counts/branch/date, 401, 403, 404 order, 409 order not receivable / another RR open |
| PATCH | `/api/receiving-reports/[id]` | the same minus `purchaseOrderId` | 200 `{ receivingReport: { id, rrNumber } }`; the caller becomes `receivedById` | 400, 401, 403, 404, 409 not a draft / changed meanwhile |

Rules (both): the order is `SENT` or `PARTIALLY_RECEIVED`; every PO line counted once; rejected ≤ received; received − rejected ≤ outstanding; date not after today (Asia/Manila); not every line zero.

## Known gaps

Recorded here so they are not mistaken for intended behaviour. None is fixed yet.

* **`POST /api/auth/register` is public and the caller chooses `role`.** Anyone who can reach the server can create an `ADMIN` account and sign in. No page calls it. It should be removed or restricted to ADMIN (with a guard and a role check) before the app is reachable by anyone else.
* **Item-master and BOM writes have no role guard.** `/api/materials`, `/api/finished-goods`, `/api/categories`, `/api/units` and `/api/boms` are only behind sign-in, so a `VIEWER` can create or edit materials, record prices (which feed PR and PO costs) and publish BOM versions. The pages using them sit under `/admin` and `/production`, which *are* guarded; the API paths are not. Reads can stay open; writes need guards or service checks.
* **`includeInactive` / `includeSuperseded` use `z.coerce.boolean()`**, which turns the string `"false"` into `true`. Omitting the parameter is the only way to get `false`. `z.enum(['true','false']).transform(v => v === 'true')` would fix it.
