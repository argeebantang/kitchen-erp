import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export type CreateFinishedGoodInput = {
  code: string
  name: string
  description?: string | null
  categoryId: string
  unitId: string
  sellingPrice: Prisma.Decimal
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
        orderBy: { name: 'asc' },
        skip:    filters.skip ?? 0,
        take:    filters.take ?? 50,
      }),
      prisma.finishedGood.count({ where }),
    ])

    return { rows, total }
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
