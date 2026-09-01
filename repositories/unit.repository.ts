import { prisma } from '@/lib/prisma'

export type CreateUnitInput = {
  name: string
  abbreviation: string
}

export const UnitRepository = {
  async findAll() {
    return prisma.unit.findMany({ orderBy: { name: 'asc' } })
  },

  async findById(id: string) {
    return prisma.unit.findUnique({ where: { id } })
  },

  async existsByNameOrAbbreviation(name: string, abbreviation: string): Promise<boolean> {
    const found = await prisma.unit.findFirst({
      where:  { OR: [{ name }, { abbreviation }] },
      select: { id: true },
    })
    return found !== null
  },

  async create(data: CreateUnitInput) {
    return prisma.unit.create({ data })
  },

  async update(id: string, data: Partial<CreateUnitInput>) {
    return prisma.unit.update({ where: { id }, data })
  },
}
