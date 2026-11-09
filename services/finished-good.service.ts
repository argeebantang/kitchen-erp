import { toDecimal, toDecimalString } from '@/lib/decimal'

/**
 * Longest shelf life a finished good may have, in hours (Week 6 Task 4, D1):
 * 30 days. Catches a typed 7200 for 720; cooked food keeps days, not months.
 */
export const MAX_SHELF_LIFE_HOURS = 720
import {
  FinishedGoodRepository,
  FinishedGoodListFilters,
  FinishedGoodWithRelations,
} from '@/repositories/finished-good.repository'

export type FinishedGoodDto = {
  id: string
  code: string
  name: string
  description: string | null
  categoryId: string
  categoryName: string
  unitId: string
  unitAbbreviation: string
  sellingPrice: string
  /** Whole hours it keeps once cooked; null until an admin sets it. */
  shelfLifeHours: number | null
  isActive: boolean
}

export type CreateFinishedGoodServiceInput = {
  code: string
  name: string
  description?: string | null
  categoryId: string
  unitId: string
  sellingPrice: string
  shelfLifeHours?: number | null
}

export type UpdateFinishedGoodServiceInput =
  Partial<Omit<CreateFinishedGoodServiceInput, 'code'>> & { isActive?: boolean }

export type FinishedGoodResult<T> =
  | { success: true;  data: T }
  | { success: false; error: string; status: number }

function toDto(good: FinishedGoodWithRelations): FinishedGoodDto {
  return {
    id:               good.id,
    code:             good.code,
    name:             good.name,
    description:      good.description,
    categoryId:       good.categoryId,
    categoryName:     good.category.name,
    unitId:           good.unitId,
    unitAbbreviation: good.unit.abbreviation,
    sellingPrice:     toDecimalString(good.sellingPrice),
    shelfLifeHours:   good.shelfLifeHours,
    isActive:         good.isActive,
  }
}

export const FinishedGoodService = {
  async list(filters: FinishedGoodListFilters = {}) {
    const { rows, total } = await FinishedGoodRepository.findMany(filters)
    return { finishedGoods: rows.map(toDto), total }
  },

  async getById(id: string): Promise<FinishedGoodResult<FinishedGoodDto>> {
    const good = await FinishedGoodRepository.findById(id)
    if (!good) {
      return { success: false, error: 'Finished good not found', status: 404 }
    }
    return { success: true, data: toDto(good) }
  },

  async create(input: CreateFinishedGoodServiceInput): Promise<FinishedGoodResult<FinishedGoodDto>> {
    if (await FinishedGoodRepository.existsByCode(input.code)) {
      return { success: false, error: 'A finished good with that code already exists', status: 409 }
    }

    const good = await FinishedGoodRepository.create({
      code:         input.code,
      name:         input.name,
      description:  input.description ?? null,
      categoryId:   input.categoryId,
      unitId:       input.unitId,
      sellingPrice: toDecimal(input.sellingPrice),
      shelfLifeHours: input.shelfLifeHours ?? null,
    })

    return { success: true, data: toDto(good) }
  },

  async update(
    id: string,
    input: UpdateFinishedGoodServiceInput,
  ): Promise<FinishedGoodResult<FinishedGoodDto>> {
    const existing = await FinishedGoodRepository.findById(id)
    if (!existing) {
      return { success: false, error: 'Finished good not found', status: 404 }
    }

    const good = await FinishedGoodRepository.update(id, {
      name:         input.name,
      description:  input.description,
      categoryId:   input.categoryId,
      unitId:       input.unitId,
      isActive:     input.isActive,
      sellingPrice: input.sellingPrice === undefined ? undefined : toDecimal(input.sellingPrice),
      // undefined leaves it unchanged; null clears it.
      shelfLifeHours: input.shelfLifeHours,
    })

    return { success: true, data: toDto(good) }
  },

  async deactivate(id: string): Promise<FinishedGoodResult<FinishedGoodDto>> {
    const existing = await FinishedGoodRepository.findById(id)
    if (!existing) {
      return { success: false, error: 'Finished good not found', status: 404 }
    }
    return { success: true, data: toDto(await FinishedGoodRepository.deactivate(id)) }
  },
}
