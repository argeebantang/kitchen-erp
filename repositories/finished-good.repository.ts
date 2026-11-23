import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { type ListSort } from '@/lib/list-query'

export type CreateFinishedGoodInput = {
  code: string
  name: string
  description?: string | null
  categoryId: string
  unitId: string
  sellingPrice: Prisma.Decimal
  /** Null clears it; omitted on an update leaves it as it is. */
  shelfLifeHours?: number | null
}

export type UpdateFinishedGoodInput = Partial<Omit<CreateFinishedGoodInput, 'code'>> & {
  isActive?: boolean
}

export type FinishedGoodListFilters = {
  search?: string
  categoryId?: string
  includeInactive?: boolean
  skip?: number
  take?: number
  /** The list page's column sort (Week 12). */
  listSort?: ListSort<FinishedGoodSortKey>
}

/** Columns the Finished Goods list can sort by (Week 12). */
export const FINISHED_GOOD_SORT_KEYS = ['code', 'name', 'category', 'unit', 'price', 'shelfLife'] as const
export type FinishedGoodSortKey = typeof FINISHED_GOOD_SORT_KEYS[number]

// Name (codes are unique) breaks ties, so a page boundary never shows a row twice or skips one.
function listOrderBy({ key, dir }: ListSort<FinishedGoodSortKey>): Prisma.FinishedGoodOrderByWithRelationInput[] {
  switch (key) {
    case 'code': return [{ code: dir }]
    case 'name': return [{ name: dir }, { id: 'asc' }]
    case 'category': return [{ category: { name: dir } }, { name: 'asc' }]
    case 'unit': return [{ unit: { name: dir } }, { name: 'asc' }]
    case 'price': return [{ sellingPrice: dir }, { name: 'asc' }]
    case 'shelfLife': return [{ shelfLifeHours: { sort: dir, nulls: 'last' } }, { name: 'asc' }]
  }
}

const finishedGoodInclude = {
  category: { select: { id: true, name: true, type: true } },
  unit:     { select: { id: true, name: true, abbreviation: true } },
} as const

export type FinishedGoodWithRelations = Prisma.FinishedGoodGetPayload<{
  include: typeof finishedGoodInclude
}>

function buildWhere(filters: FinishedGoodListFilters): Prisma.FinishedGoodWhereInput {
  const where: Prisma.FinishedGoodWhereInput = {}

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

export const FinishedGoodRepository = {
  async findMany(filters: FinishedGoodListFilters = {}) {
    const where = buildWhere(filters)

    const [rows, total] = await prisma.$transaction([
      prisma.finishedGood.findMany({
        where,
        include: finishedGoodInclude,
        orderBy: filters.listSort ? listOrderBy(filters.listSort) : { name: 'asc' },
        skip:    filters.skip ?? 0,
        take:    filters.take ?? 50,
      }),
      prisma.finishedGood.count({ where }),
    ])

    return { rows, total }
  },

  /**
   * Active finished goods whose name or code contains every word ('all') or
   * any word ('any'), case-insensitive, by name — the assistant's production
   * drafts (Week 9 Task 5, I4). Same rule as MaterialRepository.searchActive.
   */
  async searchActive(words: string[], match: 'all' | 'any', take: number): Promise<FinishedGoodWithRelations[]> {
    if (words.length === 0) return []
    const conditions: Prisma.FinishedGoodWhereInput[] = words.map(word => ({
      OR: [
        { name: { contains: word, mode: Prisma.QueryMode.insensitive } },
        { code: { contains: word, mode: Prisma.QueryMode.insensitive } },
      ],
    }))
    return prisma.finishedGood.findMany({
      where:   match === 'all' ? { isActive: true, AND: conditions } : { isActive: true, OR: conditions },
      include: finishedGoodInclude,
      orderBy: { name: 'asc' },
      take,
    })
  },

  async findById(id: string) {
    return prisma.finishedGood.findUnique({
      where:   { id },
      include: finishedGoodInclude,
    })
  },

  async existsByCode(code: string): Promise<boolean> {
    const found = await prisma.finishedGood.findUnique({
      where:  { code },
      select: { id: true },
    })
    return found !== null
  },

  async create(data: CreateFinishedGoodInput) {
    return prisma.finishedGood.create({ data, include: finishedGoodInclude })
  },

  async update(id: string, data: UpdateFinishedGoodInput) {
    return prisma.finishedGood.update({ where: { id }, data, include: finishedGoodInclude })
  },

  async deactivate(id: string) {
    return prisma.finishedGood.update({
      where:   { id },
      data:    { isActive: false },
      include: finishedGoodInclude,
    })
  },
}
