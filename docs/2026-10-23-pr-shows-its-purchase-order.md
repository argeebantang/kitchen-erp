# PR detail links to the purchase order it generated

**What changed:** the purchase request detail page now lists the purchase order(s) created when the request was approved, each with its PO number, status badge, and a link to the order.

**Why:** the PO already stored `purchaseRequestId`, and the PO pages showed the PR number, but a `CONVERTED_TO_PO` request gave no way to reach its order.

**Files affected**
- `repositories/purchase-request.repository.ts` — `detailInclude` now loads `purchaseOrders` (id, poNumber, status). Detail query only; the list query is unchanged.
- `services/purchase-request.service.ts` — `PurchaseRequestDetailDto.purchaseOrders` added and mapped in `toDetailDto`.
- `app/(protected)/procurement/requests/[id]/page.tsx` — renders the section.

**Database changes:** none (relation already existed).
**API changes:** `purchaseOrders` array added to the PR detail DTO (additive).
**UI changes:** "Purchase order" card on PR detail, shown only when at least one order exists. ADMIN, PROCUREMENT_MANAGER and ACCOUNTING get a link; other roles see the number as plain text, because middleware blocks `/procurement/orders` for them.
**Config changes:** none.

**How to verify**
1. Log in as a branch manager, create and submit a PR.
2. Log in as accounting, approve it.
3. Open the PR: the PO card appears with a working link to the order.
4. Open the same PR as the branch manager: PO number shows without a link.
5. Open a DRAFT, PENDING or REJECTED PR: no card.

**Risks / follow-up:** a branch manager can see the PO number and status of their own approved request (no amounts). Also, the DTO's `purchaseOrders` is shown for any PR a viewer can open, which is unchanged scoping.
