import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export type CreateItemPriceInput = {
  materialId: string
  supplierId?: string | null
  unitPrice: Prisma.Decimal
  effectiveDate: Date
  note?: string | null
}

export type PriceAsOf = {
  materialId: string
  supplierId: string | null
  unitPrice: Prisma.Decimal
  effectiveDate: Date
}

const historyInclude = {
  supplier: { select: { id: true, name: true } },
} as const

export type ItemPriceWithSupplier = Prisma.ItemPriceGetPayload<{
  include: typeof historyInclude
}>

/**
 * Effective-dated price history.
 *
 * Rows are open-ended — there is no endDate. The price in force on a date is
 * simply the newest row on or before it, so "current" is derived rather than
 * stored and cannot drift the way a validFrom/validTo pair can when only one of
 * its two writes lands.
 *
 * `supplierId` is nullable and the null case is meaningful:
 *   null     → the organisation-wide reference price
 *   non-null → that supplier's quoted price
 * A supplier-scoped lookup prefers that supplier's own row and falls back to the
 * reference price when the supplier has no quote on or before the date.
 */
export const ItemPriceRepository = {
  /** The price in force for ONE material. Use findPricesAsOf for a set. */
  async findPriceAsOf(
    materialId: string,
    asOf: Date,
    supplierId?: string | null,
  ): Promise<PriceAsOf | null> {
    const select = {
      materialId:    true,
      supplierId:    true,
      unitPrice:     true,
      effectiveDate: true,
    } as const

    if (supplierId) {
      const supplierPrice = await prisma.itemPrice.findFirst({
        where:   { materialId, supplierId, effectiveDate: { lte: asOf } },
        orderBy: { effectiveDate: 'desc' },
        select,
      })
      if (supplierPrice) return supplierPrice
    }

    return prisma.itemPrice.findFirst({
      where:   { materialId, supplierId: null, effectiveDate: { lte: asOf } },
      orderBy: { effectiveDate: 'desc' },
      select,
    })
  },

  /**
   * The price in force for MANY materials, in a single query.
   *
   * Calling findPriceAsOf in a loop to cost a 12-line purchase order is 12 round
   * trips — the N+1 that docs/coding-conventions.md warns about, and it looks
   * entirely reasonable in review. Postgres can express this as one statement
   * with DISTINCT ON, which Prisma's query builder cannot generate, so this is
   * deliberately raw SQL.
   *
   * The ORDER BY does the supplier fallback: within each material, rows with a
   * supplierId sort ahead of the reference row, then newest first. DISTINCT ON
   * keeps the first row per material, which is therefore the supplier's own
   * price when one exists and the reference price otherwise.
   *
   * Note `"supplierId" = $supplier` is NULL (not true) when supplier is null, so
   * a reference-only lookup naturally matches only the IS NULL rows.
   */
  async findPricesAsOf(
    materialIds: string[],
    asOf: Date,
    supplierId?: string | null,
  ): Promise<Map<string, PriceAsOf>> {
    if (materialIds.length === 0) return new Map()

    const rows = await prisma.$queryRaw<PriceAsOf[]>`
      SELECT DISTINCT ON ("materialId")
             "materialId", "supplierId", "unitPrice", "effectiveDate"
      FROM "ItemPrice"
      WHERE "materialId" IN (${Prisma.join(materialIds)})
        AND "effectiveDate" <= ${asOf}
        AND ("supplierId" = ${supplierId ?? null} OR "supplierId" IS NULL)
      ORDER BY "materialId",
               ("supplierId" IS NOT NULL) DESC,
               "effectiveDate" DESC
    `

    return new Map(rows.map(row => [row.materialId, row]))
  },

  /** Full history for one material, newest first. */
  async findHistory(materialId: string): Promise<ItemPriceWithSupplier[]> {
    return prisma.itemPrice.findMany({
      where:   { materialId },
      include: historyInclude,
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
    })
  },

  async create(data: CreateItemPriceInput): Promise<ItemPriceWithSupplier> {
    return prisma.itemPrice.create({
      data:    { ...data, supplierId: data.supplierId ?? null },
      include: historyInclude,
    })
  },
}
