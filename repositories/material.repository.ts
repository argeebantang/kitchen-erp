import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export type CreateMaterialInput = {
  code: string
  name: string
  description?: string | null
  categoryId: string
  unitId: string
  reorderPoint: Prisma.Decimal
}

export type UpdateMaterialInput = Partial<Omit<CreateMaterialInput, 'code'>> & {
  isActive?: boolean
}

export type MaterialListFilters = {
  search?: string
  categoryId?: string
  includeInactive?: boolean
  skip?: number
  take?: number
}

/**
 * Category and unit are always needed alongside a material (every list row and
 * every form shows them), so they're joined here rather than fetched per row —
 * see the N+1 guidance in docs/coding-conventions.md.
 */
const materialInclude = {
  category: { select: { id: true, name: true, type: true } },
  unit:     { select: { id: true, name: true, abbreviation: true } },
} as const

export type MaterialWithRelations = Prisma.MaterialGetPayload<{
  include: typeof materialInclude
}>

function buildWhere(filters: MaterialListFilters): Prisma.MaterialWhereInput {
  const where: Prisma.MaterialWhereInput = {}

  if (!filters.includeInactive) {
    where.isActive = true
  }

  if (filters.categoryId) {
    where.categoryId = filters.categoryId
  }

  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: 'insensitive' } },
      { code: { contains: filters.search, mode: 'insensitive' } },
    ]
  }

  return where
}

export const MaterialRepository = {
  /**
   * Paginated by default — this table grows unboundedly, and
   * docs/coding-conventions.md asks that pagination be established on the first
   * list query rather than retrofitted. Rows and total ship in one round trip.
   */
  async findMany(filters: MaterialListFilters = {}) {
    const where = buildWhere(filters)

    const [rows, total] = await prisma.$transaction([
      prisma.material.findMany({
        where,
        include: materialInclude,
        orderBy: { name: 'asc' },
        skip:    filters.skip ?? 0,
        take:    filters.take ?? 50,
      }),
      prisma.material.count({ where }),
    ])

    return { rows, total }
  },

  async findById(id: string) {
    return prisma.material.findUnique({
      where:   { id },
      include: materialInclude,
    })
  },

  /** Bulk lookup for validating a set of referenced materials in one query. */
  async findManyByIds(ids: string[]): Promise<Map<string, MaterialWithRelations>> {
    if (ids.length === 0) return new Map()

    const rows = await prisma.material.findMany({
      where:   { id: { in: ids } },
      include: materialInclude,
    })

    return new Map(rows.map(row => [row.id, row]))
  },

  async existsByCode(code: string): Promise<boolean> {
    const found = await prisma.material.findUnique({
      where:  { code },
      select: { id: true },
    })
    return found !== null
  },

  async create(data: CreateMaterialInput) {
    return prisma.material.create({
      data,
      include: materialInclude,
    })
  },

  async update(id: string, data: UpdateMaterialInput) {
    return prisma.material.update({
      where: { id },
      data,
      include: materialInclude,
    })
  },

  /**
   * Materials are deactivated, never deleted — BOM lines, purchase orders and
   * stock movements reference them, and docs/database.md requires additive over
   * destructive changes.
   */
  async deactivate(id: string) {
    return prisma.material.update({
      where: { id },
      data:  { isActive: false },
      include: materialInclude,
    })
  },
}
