import {
  CategoryRepository,
  CreateCategoryInput,
  CategoryType,
} from '@/repositories/category.repository'
import { UnitRepository, CreateUnitInput } from '@/repositories/unit.repository'

export type CategoryDto = {
  id: string
  name: string
  type: string
}

export type UnitDto = {
  id: string
  name: string
  abbreviation: string
}

export type ReferenceDataResult<T> =
  | { success: true;  data: T }
  | { success: false; error: string; status: number }

/**
 * Categories and units are small, read-mostly reference data shared by both
 * materials and finished goods, so they share one service rather than each
 * getting a near-empty one of their own.
 */
export const ReferenceDataService = {
  async listCategories(type?: CategoryType): Promise<CategoryDto[]> {
    const categories = await CategoryRepository.findAll(type)
    return categories.map(c => ({ id: c.id, name: c.name, type: c.type }))
  },

  async createCategory(input: CreateCategoryInput): Promise<ReferenceDataResult<CategoryDto>> {
    if (await CategoryRepository.existsByName(input.name)) {
      return { success: false, error: 'A category with that name already exists', status: 409 }
    }

    const category = await CategoryRepository.create(input)
    return { success: true, data: { id: category.id, name: category.name, type: category.type } }
  },

  async listUnits(): Promise<UnitDto[]> {
    const units = await UnitRepository.findAll()
    return units.map(u => ({ id: u.id, name: u.name, abbreviation: u.abbreviation }))
  },

  async createUnit(input: CreateUnitInput): Promise<ReferenceDataResult<UnitDto>> {
    if (await UnitRepository.existsByNameOrAbbreviation(input.name, input.abbreviation)) {
      return { success: false, error: 'A unit with that name or abbreviation already exists', status: 409 }
    }

    const unit = await UnitRepository.create(input)
    return {
      success: true,
      data: { id: unit.id, name: unit.name, abbreviation: unit.abbreviation },
    }
  },
}
