import { toDecimal, toDecimalString } from '@/lib/decimal'
import {
  MaterialRepository,
  MaterialListFilters,
  MaterialWithRelations,
} from '@/repositories/material.repository'
import { ItemPriceRepository } from '@/repositories/item-price.repository'

export type MaterialDto = {
  id: string
  code: string
  name: string
  description: string | null
  categoryId: string
  categoryName: string
  unitId: string
  unitAbbreviation: string
  /** String, not number — see lib/decimal.ts. */
  reorderPoint: string
  isActive: boolean
  /** Reference price in force today, or null if the material has never been priced. */
  currentPrice: string | null
}

export type CreateMaterialServiceInput = {
  code: string
  name: string
  description?: string | null
  categoryId: string
  unitId: string
  reorderPoint: string
}

export type UpdateMaterialServiceInput = Partial<Omit<CreateMaterialServiceInput, 'code'>> & {
  isActive?: boolean
}

export type MaterialResult<T> =
  | { success: true;  data: T }
  | { success: false; error: string; status: number }

function toDto(material: MaterialWithRelations, currentPrice: string | null): MaterialDto {
  return {
    id:               material.id,
    code:             material.code,
    name:             material.name,
    description:      material.description,
    categoryId:       material.categoryId,
    categoryName:     material.category.name,
    unitId:           material.unitId,
    unitAbbreviation: material.unit.abbreviation,
    reorderPoint:     toDecimalString(material.reorderPoint),
    isActive:         material.isActive,
    currentPrice,
  }
}

export const MaterialService = {
  /**
   * Prices are resolved for the whole page in ONE query via findPricesAsOf.
   * Resolving them per row would be an N+1 that scales with page size — the
   * exact trap the batch lookup exists to prevent.
   */
  async list(filters: MaterialListFilters = {}) {
    const { rows, total } = await MaterialRepository.findMany(filters)

    const prices = await ItemPriceRepository.findPricesAsOf(
      rows.map(row => row.id),
      new Date(),
    )

    return {
      materials: rows.map(row => {
        const price = prices.get(row.id)
        return toDto(row, price ? toDecimalString(price.unitPrice) : null)
      }),
      total,
    }
  },

  async getById(id: string): Promise<MaterialResult<MaterialDto>> {
    const material = await MaterialRepository.findById(id)
    if (!material) {
      return { success: false, error: 'Material not found', status: 404 }
    }

    const price = await ItemPriceRepository.findPriceAsOf(id, new Date())
    return { success: true, data: toDto(material, price ? toDecimalString(price.unitPrice) : null) }
  },

  async create(input: CreateMaterialServiceInput): Promise<MaterialResult<MaterialDto>> {
    if (await MaterialRepository.existsByCode(input.code)) {
      return { success: false, error: 'A material with that code already exists', status: 409 }
    }

    const material = await MaterialRepository.create({
      code:         input.code,
      name:         input.name,
      description:  input.description ?? null,
      categoryId:   input.categoryId,
      unitId:       input.unitId,
      reorderPoint: toDecimal(input.reorderPoint),
    })

    return { success: true, data: toDto(material, null) }
  },

  async update(id: string, input: UpdateMaterialServiceInput): Promise<MaterialResult<MaterialDto>> {
    const existing = await MaterialRepository.findById(id)
    if (!existing) {
      return { success: false, error: 'Material not found', status: 404 }
    }

    const material = await MaterialRepository.update(id, {
      name:         input.name,
      description:  input.description,
      categoryId:   input.categoryId,
      unitId:       input.unitId,
      isActive:     input.isActive,
      reorderPoint: input.reorderPoint === undefined ? undefined : toDecimal(input.reorderPoint),
    })

    const price = await ItemPriceRepository.findPriceAsOf(id, new Date())
    return { success: true, data: toDto(material, price ? toDecimalString(price.unitPrice) : null) }
  },

  async deactivate(id: string): Promise<MaterialResult<MaterialDto>> {
    const existing = await MaterialRepository.findById(id)
    if (!existing) {
      return { success: false, error: 'Material not found', status: 404 }
    }

    const material = await MaterialRepository.deactivate(id)
    return { success: true, data: toDto(material, null) }
  },
}
