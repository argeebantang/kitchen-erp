import { prisma } from '@/lib/prisma'

export const BranchRepository = {
  /**
   * Oldest first, so the branch seeded first — Main Commissary, where supplier
   * deliveries land by default — heads the list and becomes the form default.
   */
  async findAllActive(): Promise<{ id: string; name: string }[]> {
    return prisma.branch.findMany({
      where:   { isActive: true },
      select:  { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    })
  },

  async findById(id: string): Promise<{ id: string; name: string; isActive: boolean } | null> {
    return prisma.branch.findUnique({
      where:  { id },
      select: { id: true, name: true, isActive: true },
    })
  },
}
