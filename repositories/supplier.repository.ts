import { prisma } from '@/lib/prisma'

export const SupplierRepository = {
  /** Minimal projection — the price panel only needs id + name for a dropdown. */
  async findAllActive(): Promise<{ id: string; name: string }[]> {
    return prisma.supplier.findMany({
      where:   { isActive: true },
      select:  { id: true, name: true },
      orderBy: { name: 'asc' },
    })
  },

  async findById(id: string): Promise<{ id: string; name: string } | null> {
    return prisma.supplier.findUnique({
      where:  { id },
      select: { id: true, name: true },
    })
  },

}
