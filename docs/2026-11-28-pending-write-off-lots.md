# Lots waiting to be written off are not converted or sent out

**2026-11-28. Bug fix, found by the production integration tests** (`docs/2026-11-28-automated-testing-plan.md`,
subtask 5).

## The bug

A lot recorded for write-off, for example found **spoiled** or **damaged** before it expired, could be used by a
conversion or a transfer approved while the write-off waited for accounting.

Reproduced by `tests/integration/production.test.ts`, "a lot waiting to be written off":
1. Lot PRD-000001 (3 kg Lechon, expiring in 10 h) is recorded for write-off as SPOILED.
2. A 5 kg Lechon → Paksiw conversion is recorded. It is allowed: 13 kg unexpired − 3 kg claimed = 10 kg available.
3. On approval, the conversion took **all 3 kg of the spoiled lot** (soonest expiry first), then 2 kg of the good lot.
4. That made 6 kg of Paksiw, lot CNV-000001.
5. The write-off could then never be approved: "Lot PRD-000001 holds only 0 kg now…" (409).

Spoiled Lechon became food on the shelf, and the waste never reached the books. A transfer approval did the same,
sending the spoiled lot to an outlet.

**Why:** a pending write-off's claim was counted only as a **total**. The conversion's, transfer's and write-off's own
"available" figures all subtracted it, so nobody over-promised kilos. But at approval, `planFefoTakes` ran over the
lots as they stood, so the claimed kilos were taken first whenever their lot expired soonest. The Week 7 notes listed
"approval takes whatever the lot holds then" as a known limitation, but that contradicted their own rule W5: "a
write-off and a conversion cannot count the same kilo".

## The fix

Conversions and transfers plan from each lot **less what pending write-offs claim on it**:
- **`withoutClaims(levels, claims)`** (`repositories/finished-good-stock.repository.ts`, next to `planFefoTakes`):
  a pure function. It takes each lot's claim off the lot and leaves fully claimed lots out.
- **`WriteOffRepository.pendingClaimsByLot(finishedGoodId, branchId, db)`**: pending write-off quantities by lot.
  It takes the caller's transaction.
- **Used in all four places that plan lots**, so preview and approval still agree:
  - `ConversionOrderRepository.decide`: approval, under the existing lot lock
  - `sourceAt` in `services/conversion-order.service.ts`: the conversion preview
  - `dispatch` in `repositories/stock-transfer.repository.ts`: transfer approval and returns, under the lock
  - `availabilityAt` → `planLine` in `services/stock-transfer.service.ts`: the transfer preview. It returns a new
    `usable` list; `levels` is unchanged for the on-hand figures.
- **The shortage messages** now say "…unexpired and not claimed by a pending write-off".

The "available" totals do not change. They already subtracted the claims. Only **which lots** are taken changes.

## What it means for users

- A conversion or transfer takes the next lot instead of the one waiting to be written off, and the write-off can
  always be approved.
- An unclaimed part of a lot is still used: 1 kg claimed of a 3 kg lot leaves 2 kg usable, soonest expiry first.
- A conversion or transfer that only fits by using claimed kilos is refused at approval (409), as for any shortage.
  Before, it would have gone through and broken the write-off.

## Files

- `repositories/finished-good-stock.repository.ts`: `withoutClaims`
- `repositories/write-off.repository.ts`: `pendingClaimsByLot`
- `repositories/conversion-order.repository.ts`, `repositories/stock-transfer.repository.ts`: approval and
  dispatch plan without claims
- `services/conversion-order.service.ts`, `services/stock-transfer.service.ts`: previews plan the same way

No database, API, UI or configuration changes.

## How to verify

- `npx vitest run tests/integration/production.test.ts -t "waiting to be written off"`: 3 tests, covering
  conversion, transfer and a part-claimed lot.
- `npx vitest run tests/unit/fefo.test.ts`: the `withoutClaims` cases.
- **Reverting the fix fails all six.** Checked by making `withoutClaims` return the lots unchanged.

## Risks and follow-up

- **One extra query per approval**, inside the transaction, on an indexed table (`WriteOff` by status and lot).
- **A write-off recorded while a conversion is being approved isn't covered.** Write-off creation does not take the
  lot lock, so a write-off recorded in the very same moment can still miss the approval. The write-off approval
  re-check (409) still catches it, as before.
- **Outlet sales are deliberately unchanged** (`OutletSaleRepository.create`). A sale is recorded after the goods are
  sold, so refusing it would block bookkeeping of what already happened. A sale can still take from a lot with a
  pending write-off, and the write-off is then refused. Revisit if write-offs at outlets become common.
