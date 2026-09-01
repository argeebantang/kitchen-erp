import { toDecimal, toDecimalString } from '@/lib/decimal'
import { ItemPriceRepository } from '@/repositories/item-price.repository'
import { MaterialRepository } from '@/repositories/material.repository'

export type ItemPriceDto = {
  id: string
  materialId: string
  supplierId: string | null
  supplierName: string | null
  unitPrice: string
  effectiveDate: string
  note: string | null
}

export type CreateItemPriceServiceInput = {
  materialId: string
  supplierId?: string | null
  unitPrice: string
  effectiveDate: string
  note?: string | null
}

export type ItemPriceResult<T> =
  | { success: true;  data: T }
  | { success: false; error: string; status: number }

export const ItemPriceService = {
  async history(materialId: string): Promise<ItemPriceResult<ItemPriceDto[]>> {
    const material = await MaterialRepository.findById(materialId)
    if (!material) {
      return { success: false, error: 'Material not found', status: 404 }
    }

    const prices = await ItemPriceRepository.findHistory(materialId)

    return {
      success: true,
      data: prices.map(price => ({
        id:            price.id,
        materialId:    price.materialId,
        supplierId:    price.supplierId,
        supplierName:  price.supplier?.name ?? null,
        unitPrice:     toDecimalString(price.unitPrice),
        effectiveDate: price.effectiveDate.toISOString(),
        note:          price.note,
      })),
    }
  },

  /**
   * Recording a price is always an INSERT — never an update of the previous
   * row. Correcting a price is itself a new row, so the history of what the
   * system believed at each point stays intact. That audit trail is what Week 6
   * cost variance and the Week 9 Cost Variance Explainer read.
   *
   * Back-dating is allowed on purpose: invoices arrive late, and a price that
   * took effect last Monday has to be recordable on Friday.
   */
  async record(input: CreateItemPriceServiceInput): Promise<ItemPriceResult<ItemPriceDto>> {
    const material = await MaterialRepository.findById(input.materialId)
    if (!material) {
      return { success: false, error: 'Material not found', status: 404 }
    }

    const unitPrice = toDecimal(input.unitPrice)
    if (unitPrice.isNegative()) {
      return { success: false, error: 'Unit price cannot be negative', status: 400 }
    }

    const price = await ItemPriceRepository.create({
      materialId:    input.materialId,
      supplierId:    input.supplierId ?? null,
      unitPrice,
      effectiveDate: new Date(input.effectiveDate),
      note:          input.note ?? null,
    })

    return {
      success: true,
      data: {
        id:            price.id,
        materialId:    price.materialId,
        supplierId:    price.supplierId,
        supplierName:  price.supplier?.name ?? null,
        unitPrice:     toDecimalString(price.unitPrice),
        effectiveDate: price.effectiveDate.toISOString(),
        note:          price.note,
      },
    }
  },
}
