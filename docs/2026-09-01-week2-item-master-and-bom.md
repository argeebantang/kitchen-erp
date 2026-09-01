# 2026-09-01 — Week 2: Item Master, effective-dated prices, and Bill of Materials

Delivers the Week 2 sprint scope: master data CRUD at `/admin/master`, effective-dated purchase
prices, and the BOM module with a scaled viewer and version history at `/production/bom`.

## What changed

### Schema (migration `20260901101054_week2_item_prices_and_bom_batch`)

- **New `ItemPrice` model** — effective-dated purchase price history per `Material`.
- **`BOM.batchSize` + `BOM.batchUnitId`** — required. BOM lines are stated per batch, so without
  a denominator there was nothing to scale from.
- **Constraints and indexes** — `@@unique([finishedGoodId, version])` on `BOM`, plus
  `@@index` on `BOM([finishedGoodId, isActive])`, `BOMItem([bomId])`, `Material([categoryId])`,
  and two on `ItemPrice`. Postgres does not auto-index foreign keys (see `docs/database.md`), and
  all of these become join or filter targets in this week's queries.

### Layers

Follows the existing route handler → service → repository shape from the auth module.

| Layer | Added |
|---|---|
| Repositories | `category`, `unit`, `material`, `finished-good`, `item-price`, `bom`, `supplier` |
| Services | `reference-data`, `material`, `finished-good`, `item-price`, `bom` |
| API | `/api/materials`, `/api/materials/[id]`, `/api/materials/[id]/prices`, `/api/finished-goods`, `/api/finished-goods/[id]`, `/api/finished-goods/[id]/bom-versions`, `/api/categories`, `/api/units`, `/api/boms`, `/api/boms/[id]` |
| Pages | `/admin/master` (4 tabs), `/production/bom`, `/production/bom/[id]` |
| Components | `components/master/*`, `components/bom/BomScaleControl`, `components/ui/{Modal,form}` |
| lib | `lib/decimal.ts`, `lib/format.ts` |

No changes to `middleware.ts` `ROLE_GUARDS` or `lib/navigation.ts` were needed — `/admin` and
`/production` were already guarded and both sidebar links already existed. Week 2 turns two of the
nine dead links into real pages.

## Why the design went this way

### `ItemPrice` is open-ended, with no `endDate`

The alternative was `validFrom`/`validTo` ranges. Rejected because every price change would then
be a **two-row write** — close the old row, open the new — and that invariant eventually gets
violated by a crash or a manual fix, leaving overlapping or gapped ranges that silently return a
wrong price. With open-ended rows, "the current price" is *derived and never stored*, so it cannot
be inconsistent. The cost is an `ORDER BY effectiveDate DESC LIMIT 1` on every read, which the
index covers.

Recording a price is always an INSERT. Even correcting a price is a new row, so the history of
what the system believed at each point survives — that trail is what Week 6 variance and the
Week 9 Cost Variance Explainer read.

### `supplierId` is nullable and the null case is meaningful

- `null` → the organisation-wide reference price
- non-null → that supplier's quoted price

`findPriceAsOf(materialId, asOf, supplierId?)` prefers the supplier's own row and falls back to
the reference row when that supplier has no quote on or before the date.

### BOM lines are stored per batch, not normalised per unit

Real recipes are written per batch ("this makes 10 kg"). Normalising to a single unit would round
small ingredients (0.0035 kg of salt per kg) and make the stored rows impossible to check against
the physical recipe card. Storing the batch as authored keeps the source data exact; scaling is
derived as `factor = targetQuantity / batchSize`.

### BOM versions are immutable

There is deliberately **no update path** on `BomRepository` — `createVersion` is also the edit
path. `ProductionOrder` pins `bomId`, so mutating an active BOM in place would retroactively
change which ingredients a *completed* production run claims to have consumed. Versioning every
edit makes that impossible by construction rather than by discipline.

`createVersion` reads the highest version and writes version + 1 inside one transaction; two
concurrent edits would otherwise both read v3 and both write v4. `@@unique([finishedGoodId,
version])` is the backstop that turns that race into a failed write rather than a duplicate.

### Scaling happens on the server

`BomService.scaleBomQuantities` is exported separately because **Week 5 needs exactly this** to
derive production order material requirements. One implementation means the scaled viewer and the
production order cannot disagree about what a 25 kg batch requires.

It also keeps the arithmetic in `Prisma.Decimal`. Multiplying in the browser would mean JS floats,
reintroducing imprecision into quantities that Weeks 6–8 then cost. The viewer therefore pushes
the target into the URL (`?qty=25`) and re-renders server-side; the tradeoff accepted is one
debounced round trip per change instead of instant client math.

## Traps avoided (worth remembering)

1. **Prisma `Decimal` cannot cross into a Client Component.** It's a Decimal.js class instance and
   Next throws *"Only plain objects can be passed to Client Components"*. Converting with
   `Number()` silences the error while reintroducing float imprecision. Every Decimal is converted
   to a **string** in the service layer via `lib/decimal.ts`.

2. **A function exported from a `'use client'` module cannot be called by a Server Component.**
   `trimDecimal` originally lived in `MaterialsPanel.tsx`; importing it into the BOM pages made it
   a client-reference proxy and every request 500'd with *"Attempted to call trimDecimal() from
   the server"*. **Neither `tsc --noEmit` nor `next build` caught it** — only an actual request
   did. Moved to `lib/format.ts`, which is runtime-neutral (no `'use client'`, no Prisma import).

3. **N+1 on price lookups.** Costing a 12-line BOM by calling `findPriceAsOf` per line is 12 round
   trips and looks perfectly reasonable in review. `findPricesAsOf` does it in one query using
   Postgres `DISTINCT ON`, which Prisma's query builder cannot express — hence deliberate
   `$queryRaw`. The `ORDER BY materialId, ("supplierId" IS NOT NULL) DESC, "effectiveDate" DESC`
   is what implements the supplier→reference fallback in a single statement.

4. **Next.js 15 `params` and `searchParams` are Promises** and must be awaited. Destructuring them
   the Next 14 way yields `undefined` rather than a type error.

5. **Unit mismatch.** There is no unit-conversion layer yet, so `BomService` rejects a line whose
   unit differs from the material's stocking unit. A line authored in grams against a material
   stocked in kg would otherwise be silently 1000× wrong once Weeks 5–8 cost it.

## Database changes

Additive only. New `ItemPrice` table; two new required columns on `BOM` (safe — the table was
empty, verified before migrating); new indexes and one unique constraint. No column was dropped,
narrowed, or renamed. `Material.standardCost` is retained and marked deprecated in the schema —
nothing reads it. Drop it in a later change once that's confirmed to hold.

## API changes

All new; no existing endpoint changed shape. All input is zod-validated at the route boundary.
**Decimals cross the API as strings, never numbers** — a JS number cannot round-trip the
precision the column holds.

`POST /api/boms` is both create and edit: posting for a finished good that already has a BOM
supersedes the active version with version + 1. There is no `PATCH`.

## UI changes

- `/admin/master` — four tabs via `?tab=`, so each tab is a plain server render and the view is
  bookmarkable. Price history opens per material, with a back-dateable "record price" form.
- `/production/bom` — card list of active BOMs, with a toggle to include superseded versions.
- `/production/bom/[id]` — scaled viewer with preset multipliers, per-line and total cost, cost
  per unit, and the full version history table.

Mutations post to the API and then call `router.refresh()` to re-run the server component that
rendered the list, rather than maintaining a client-side cache.

## Configuration changes

- `next.config.ts` — added `eslint.dirs`. `next lint` defaults to `app`, `pages`, `components`,
  `lib` and `src` only, silently skipping `repositories/` and `services/` where most of the logic
  lives.
- `@eslint/eslintrc` added as an explicit devDependency (it was only present transitively).

## Seed data

19 materials, 25 price rows, 1 supplier, 4 categories, 4 units, and three real BOMs: Dinuguan
(10 kg, 11 lines), Lechon Paksiw (10 kg, 9 lines), Bopis (8 kg, 14 lines).

Prices include deliberate history so the effective-dated lookup is demonstrable rather than
theoretical — Pork Belly has rows at 2026-05-01 (₱340), 07-01 (₱365), 08-01 (₱380) plus a
supplier-specific quote at 08-10 (₱355).

The seed is idempotent: materials/goods/categories/units upsert on their natural keys, prices are
skipped when the material already has rows, and BOMs are skipped when one already exists — a
re-run must not stack versions, since versions represent real recipe changes.

## How to verify

```bash
# Schema and migration state
npx prisma migrate status        # expect: 2 migrations found, schema up to date

# CI's three steps
npx tsc --noEmit
npm run lint
npx prisma validate

# Seed (safe to run repeatedly — counts should not change on a second run)
npx prisma db seed

# Run it
npm run dev                      # admin@kitchen.com / password123
```

Then check by hand:

1. `/admin/master` — 19 materials with current prices; the clock icon opens price history.
   Record a back-dated price and confirm the "current price" column only changes if the new row
   is the newest on or before today.
2. `/production/bom` — three dishes. Open Dinuguan: batch cost **₱1,905.50**, cost/kg **₱190.55**.
3. Set the scale control to **25** — pork belly goes 4 kg → 10 kg, total → **₱4,763.75**, and
   cost/kg stays **₱190.55**. A constant cost/unit across scales is the quick correctness check.
4. Edit a BOM (POST to `/api/boms` for an existing finished good) — the version history table
   should show the old version as Superseded and the new one Active.

**Important:** verify against a production build too, not just `next dev` —
`npm run build && npm start`. Two of the bugs found this week were invisible in dev.

## Risks, assumptions, follow-up

- **Assumption:** BOM line units always equal the material's stocking unit. Enforced in
  `BomService`. A real unit-conversion layer (g↔kg, mL↔L) is deferred; revisit before Week 5 if
  recipes need mixed units.
- **`Category.type` is free text**, validated against the three known strings via zod in
  `CATEGORY_TYPES`. Formalising it as a Prisma enum is a separate change.
- **No branch scoping.** Prices and BOMs are organisation-wide. If per-branch pricing is ever
  needed, `ItemPrice` gains a nullable `branchId` following the same null-means-default pattern
  as `supplierId`.
- **Pagination is implemented but not surfaced.** Repositories take `skip`/`take` (default 50) and
  the pages request `take: 100`; there is no pager UI yet. Add one before the material list
  realistically exceeds 100 rows.
- **Follow-up:** drop `Material.standardCost` once nothing depends on it.
- **Follow-up:** upgrade `eslint-config-next` to 15.5+ and drop the `FlatCompat` bridge.
