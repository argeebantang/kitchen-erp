import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export type BomLineInput = {
  materialId: string
  quantity: Prisma.Decimal
  unitId: string
  notes?: string | null
}

export type CreateBomVersionInput = {
  finishedGoodId: string
  batchSize: Prisma.Decimal
  batchUnitId: string
  notes?: string | null
  items: BomLineInput[]
}

/**
 * A BOM is never shown without its lines, and a line is never useful without
 * its material and unit — so the whole tree is fetched in one query. Loading
 * the BOM then looping lines to resolve materials is the N+1 this avoids.
 */
const bomDetailInclude = {
  finishedGood: {
    select: {
      id: true, code: true, name: true,
      unit: { select: { id: true, name: true, abbreviation: true } },
    },
  },
  batchUnit: { select: { id: true, name: true, abbreviation: true } },
  items: {
    include: {
      material: { select: { id: true, code: true, name: true, unitId: true } },
      unit:     { select: { id: true, name: true, abbreviation: true } },
    },
    orderBy: { material: { name: 'asc' } },
  },
} as const

export type BomWithDetail = Prisma.BOMGetPayload<{ include: typeof bomDetailInclude }>

const bomSummaryInclude = {
  finishedGood: { select: { id: true, code: true, name: true } },
  batchUnit:    { select: { id: true, abbreviation: true } },
  _count:       { select: { items: true } },
} as const

export type BomSummary = Prisma.BOMGetPayload<{ include: typeof bomSummaryInclude }>

export type BomListFilters = {
  finishedGoodId?: string
  includeSuperseded?: boolean
  skip?: number
  take?: number
}

export const BomRepository = {
  /** Active versions by default — superseded ones are history, not list rows. */
  async findMany(filters: BomListFilters = {}) {
    const where: Prisma.BOMWhereInput = {}

    if (!filters.includeSuperseded) {
      where.isActive = true
    }
    if (filters.finishedGoodId) {
      where.finishedGoodId = filters.finishedGoodId
    }

    const [rows, total] = await prisma.$transaction([
      prisma.bOM.findMany({
        where,
        include: bomSummaryInclude,
        orderBy: [{ finishedGood: { name: 'asc' } }, { version: 'desc' }],
        skip:    filters.skip ?? 0,
        take:    filters.take ?? 50,
      }),
      prisma.bOM.count({ where }),
    ])

    return { rows, total }
  },

  async findById(id: string): Promise<BomWithDetail | null> {
    return prisma.bOM.findUnique({ where: { id }, include: bomDetailInclude })
  },

  async findActiveByFinishedGood(finishedGoodId: string): Promise<BomWithDetail | null> {
    return prisma.bOM.findFirst({
      where:   { finishedGoodId, isActive: true },
      include: bomDetailInclude,
    })
  },

  /** Version history for one finished good — newest first, lines not needed. */
  async findVersions(finishedGoodId: string) {
    return prisma.bOM.findMany({
      where:   { finishedGoodId },
      include: { batchUnit: { select: { abbreviation: true } }, _count: { select: { items: true } } },
      orderBy: { version: 'desc' },
    })
  },

  /**
   * Creates the next version and supersedes the current one atomically.
   *
   * There is no update() on this repository by design. ProductionOrder pins
   * bomId, so mutating an active BOM in place would retroactively change which
   * ingredients a completed production run claims to have consumed. Versioning
   * every edit makes that impossible by construction rather than by discipline.
   *
   * The read of the highest version and the write of version + 1 must be one
   * transaction — two concurrent edits would otherwise both read version 3 and
   * both try to write version 4. The @@unique([finishedGoodId, version]) added
   * in this migration is the backstop that turns that race into a failed write
   * instead of a duplicate.
   */
  async createVersion(input: CreateBomVersionInput): Promise<BomWithDetail> {
    return prisma.$transaction(async tx => {
      const latest = await tx.bOM.findFirst({
        where:   { finishedGoodId: input.finishedGoodId },
        orderBy: { version: 'desc' },
        select:  { version: true },
      })

      await tx.bOM.updateMany({
        where: { finishedGoodId: input.finishedGoodId, isActive: true },
        data:  { isActive: false },
      })

      return tx.bOM.create({
        data: {
          finishedGoodId: input.finishedGoodId,
          version:        (latest?.version ?? 0) + 1,
          isActive:       true,
          batchSize:      input.batchSize,
          batchUnitId:    input.batchUnitId,
          notes:          input.notes ?? null,
          items:          { create: input.items },
        },
        include: bomDetailInclude,
      })
    })
  },
}
