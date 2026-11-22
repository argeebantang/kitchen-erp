import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type PriceRow = { materialId: string; supplierId: string | null; unitPrice: Prisma.Decimal; effectiveDate: Date }

/**
 * Every ItemPrice in memory, looked up like ItemPriceRepository.findPricesAsOf:
 * the newest price on or before the end of the date, the supplier's own when
 * it has one, the reference price otherwise. Thousands of lookups would
 * otherwise be thousands of queries.
 */
export async function loadPrices() {
  const rows: PriceRow[] = await prisma.itemPrice.findMany({
    select:  { materialId: true, supplierId: true, unitPrice: true, effectiveDate: true },
    orderBy: { effectiveDate: 'desc' },
  })

  /** Price in force on `date` (YYYY-MM-DD); null when none. */
  function asOf(materialId: string, date: string, supplierId: string | null = null): Prisma.Decimal | null {
    const endOfDay = new Date(`${date}T23:59:59.999Z`)
    let reference: Prisma.Decimal | null = null
    for (const row of rows) {
      if (row.materialId !== materialId || row.effectiveDate > endOfDay) continue
      if (supplierId !== null && row.supplierId === supplierId) return row.unitPrice
      if (row.supplierId === null && reference === null) reference = row.unitPrice
    }
    return reference
  }

  return { asOf }
}

export type Prices = Awaited<ReturnType<typeof loadPrices>>
