import { BomKind, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export type BomLineInput = {
  materialId: string
  quantity: Prisma.Decimal
  unitId: string
  notes?: string | null
}

export type CreateBomVersionInput = {
  finishedGoodId: string
  kind: BomKind
  /** CONVERSION only (both or neither — the CHECK constraint holds it). */
  source: { finishedGoodId: string; quantity: Prisma.Decimal } | null
  batchSize: Prisma.Decimal
  batchUnitId: string
  notes?: string | null
  items: BomLineInput[]
}

/**
 * A BOM is never shown without its lines, and a line is never useful without
 * its material and unit — so the whole tree is fetched in one query. Loading
 * the BOM then looping lines to resolve materials is the N+1 this avoids.
 *
 * Exported so a query through another model (a production order's pinned
 * BOM) can load the same tree and get a BomWithDetail-shaped result.
 */
export const bomDetailInclude = {
  finishedGood: {
    select: {
      // shelfLifeHours: a conversion's output lot expires that long after it (Week 7 Task 1, D8).
      id: true, code: true, name: true, shelfLifeHours: true,
      unit: { select: { id: true, name: true, abbreviation: true } },
    },
  },
  batchUnit: { select: { id: true, name: true, abbreviation: true } },
  sourceFinishedGood: {
    select: {
      id: true, code: true, name: true,
      unit: { select: { id: true, name: true, abbreviation: true } },
    },
  },
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
  sourceFinishedGood: { select: { name: true, unit: { select: { abbreviation: true } } } },
  batchUnit:    { select: { id: true, abbreviation: true } },
  _count:       { select: { items: true } },
} as const

export type BomSummary = Prisma.BOMGetPayload<{ include: typeof bomSummaryInclude }>

export type BomListFilters = {
  finishedGoodId?: string
  kind?: BomKind
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
    if (filters.kind) {
      where.kind = filters.kind
    }

    const [rows, total] = await prisma.$transaction([
      prisma.bOM.findMany({
        where,
        include: bomSummaryInclude,
        orderBy: [{ finishedGood: { name: 'asc' } }, { kind: 'asc' }, { version: 'desc' }],
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

  /**
   * The active version of one kind (Week 7 Task 1, D2). `kind` is required so
   * every caller says which recipe it means: production planning must never
   * pick up a conversion recipe, and the other way round.
   */
  async findActiveByFinishedGood(finishedGoodId: string, kind: BomKind): Promise<BomWithDetail | null> {
    return prisma.bOM.findFirst({
      where:   { finishedGoodId, kind, isActive: true },
      include: bomDetailInclude,
    })
  },

  /**
   * Every active PRODUCTION version whose finished good is active too — what a
   * production order can be planned from (conversion recipes are made through
   * conversion orders instead). Header only, unpaged: at most one row per
   * finished good, and the production order form needs them all in its picker.
   */
  async findAllActiveForPlanning() {
    return prisma.bOM.findMany({
      where:   { kind: BomKind.PRODUCTION, isActive: true, finishedGood: { isActive: true } },
      select:  {
        id: true, version: true, batchSize: true, batchUnitId: true,
        batchUnit:    { select: { abbreviation: true } },
        finishedGood: { select: { id: true, code: true, name: true, unitId: true } },
      },
      orderBy: { finishedGood: { name: 'asc' } },
    })
  },

  /**
   * Every active CONVERSION version whose output is active — what a conversion
   * order can be recorded against (Week 7 Task 1). Header and source only,
   * unpaged: at most one row per finished good.
   */
  async findAllActiveConversions() {
    return prisma.bOM.findMany({
      where:   { kind: BomKind.CONVERSION, isActive: true, finishedGood: { isActive: true } },
      select:  {
        id: true, version: true, batchSize: true, sourceQuantity: true,
        batchUnit:          { select: { abbreviation: true } },
        finishedGood:       { select: { id: true, code: true, name: true } },
        sourceFinishedGood: { select: { id: true, code: true, name: true, unit: { select: { abbreviation: true } } } },
      },
      orderBy: { finishedGood: { name: 'asc' } },
    })
  },

  /**
   * Version history for one finished good — newest first, lines not needed.
   * One kind's history when `kind` is given (each kind numbers its own versions).
   */
  async findVersions(finishedGoodId: string, kind?: BomKind) {
    return prisma.bOM.findMany({
      where:   { finishedGoodId, ...(kind ? { kind } : {}) },
      include: { batchUnit: { select: { abbreviation: true } }, _count: { select: { items: true } } },
      orderBy: [{ kind: 'asc' }, { version: 'desc' }],
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
   * both try to write version 4. The @@unique([finishedGoodId, kind, version])
   * is the backstop that turns that race into a failed write
   * instead of a duplicate.
   *
   * All of it is per kind (Week 7 Task 1, D2): a new conversion version
   * supersedes only the conversion recipe, never the production one, and
   * takes the next number in its own series.
   */
  async createVersion(input: CreateBomVersionInput): Promise<BomWithDetail> {
    return prisma.$transaction(async tx => {
      const latest = await tx.bOM.findFirst({
        where:   { finishedGoodId: input.finishedGoodId, kind: input.kind },
        orderBy: { version: 'desc' },
        select:  { version: true },
      })

      await tx.bOM.updateMany({
        where: { finishedGoodId: input.finishedGoodId, kind: input.kind, isActive: true },
        data:  { isActive: false },
      })

      return tx.bOM.create({
        data: {
          finishedGoodId: input.finishedGoodId,
          kind:           input.kind,
          sourceFinishedGoodId: input.source?.finishedGoodId ?? null,
          sourceQuantity:       input.source?.quantity ?? null,
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
