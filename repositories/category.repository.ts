import { prisma } from '@/lib/prisma'

/**
 * `Category.type` is a free-text column rather than a Prisma enum (see
 * docs/database.md). These three strings are the fixed set until it's
 * formalised — this is the single place they're declared.
 */
export const CATEGORY_TYPES = ['RAW_MATERIAL', 'FINISHED_GOOD', 'PACKAGING'] as const
export type CategoryType = (typeof CATEGORY_TYPES)[number]

export type CreateCategoryInput = {
  name: string
  type: CategoryType
}

export const CategoryRepository = {
  async findAll(type?: CategoryType) {
    return prisma.category.findMany({
      where:   type ? { type } : undefined,
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    })
  },

  async findById(id: string) {
    return prisma.category.findUnique({ where: { id } })
  },

  async existsByName(name: string): Promise<boolean> {
    const found = await prisma.category.findUnique({
      where:  { name },
      select: { id: true },
    })
    return found !== null
  },

  async create(data: CreateCategoryInput) {
    return prisma.category.create({ data })
  },

  async update(id: string, data: Partial<CreateCategoryInput>) {
    return prisma.category.update({ where: { id }, data })
  },
}
