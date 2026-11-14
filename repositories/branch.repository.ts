import { BranchType, ConversionStatus, Prisma, ProductionStatus, RRStatus, TransferStatus, WriteOffStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'

const withManager = {
  manager: { select: { id: true, name: true, email: true } },
} satisfies Prisma.BranchInclude

export type BranchWithManager = Prisma.BranchGetPayload<{ include: typeof withManager }>

export type CreateBranchInput = {
  code: string
  name: string
  type: BranchType
  address: string | null
  phone: string | null
  managerId: string | null
}

export type UpdateBranchInput = Partial<Omit<CreateBranchInput, 'code'>>

/**
 * Locks every active commissary row and returns their ids. Taken before a
 * change that could leave none (an edit to Outlet, a deactivation) so two
 * admins changing the last two at once cannot both pass the check — the
 * second waits, then sees the first's change.
 */
async function lockActiveCommissaries(tx: Prisma.TransactionClient): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Branch"
    WHERE type = 'COMMISSARY' AND "isActive" = true
    ORDER BY id
    FOR UPDATE`
  return rows.map(r => r.id)
}

/**
 * A manager runs one branch (B4): before giving `managerId` to a branch, take
 * them off any other. Same transaction as the assignment, so the move is all
 * or nothing; two admins assigning the same person at once still meet the
 * unique index on managerId.
 */
async function releaseManager(tx: Prisma.TransactionClient, managerId: string, keepBranchId?: string): Promise<void> {
  await tx.branch.updateMany({
    where: { managerId, ...(keepBranchId ? { id: { not: keepBranchId } } : {}) },
    data:  { managerId: null },
  })
}

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

  /** For Master Data and GET /api/branches — same order as findAllActive. */
  async findAll(includeInactive: boolean): Promise<BranchWithManager[]> {
    return prisma.branch.findMany({
      where:   includeInactive ? {} : { isActive: true },
      include: withManager,
      orderBy: { createdAt: 'asc' },
    })
  },

  async findById(id: string): Promise<{ id: string; name: string; isActive: boolean } | null> {
    return prisma.branch.findUnique({
      where:  { id },
      select: { id: true, name: true, isActive: true },
    })
  },

  /** Case-insensitive, so "main commissary" cannot sit beside "Main Commissary". */
  async existsByName(name: string, exceptId?: string): Promise<boolean> {
    const found = await prisma.branch.findFirst({
      where:  { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    })
    return found !== null
  },

  async existsByCode(code: string): Promise<boolean> {
    const found = await prisma.branch.findUnique({ where: { code }, select: { id: true } })
    return found !== null
  },

  async create(data: CreateBranchInput): Promise<BranchWithManager> {
    return prisma.$transaction(async tx => {
      if (data.managerId) await releaseManager(tx, data.managerId)
      return tx.branch.create({ data, include: withManager })
    })
  },

  /**
   * Updates a profile; a `managerId` here moves that manager off any other
   * branch. With `keepACommissary` (the edit turns an active
   * commissary into an outlet), refuses — returns 'LAST_COMMISSARY' — when no
   * other active commissary would remain. Null when the branch is gone.
   */
  async update(
    id: string,
    data: UpdateBranchInput,
    keepACommissary: boolean,
  ): Promise<BranchWithManager | 'LAST_COMMISSARY' | null> {
    return prisma.$transaction(async tx => {
      if (keepACommissary) {
        const others = (await lockActiveCommissaries(tx)).filter(other => other !== id)
        if (others.length === 0) return 'LAST_COMMISSARY'
      }
      // Checked before the release, so a missing branch never costs another
      // branch its manager. Branches are never deleted, so no lock is needed.
      if (data.managerId) {
        if (!(await tx.branch.findUnique({ where: { id }, select: { id: true } }))) return null
        await releaseManager(tx, data.managerId, id)
      }
      const { count } = await tx.branch.updateMany({ where: { id }, data })
      if (count === 0) return null
      return tx.branch.findUniqueOrThrow({ where: { id }, include: withManager })
    })
  },

  /**
   * What stops a branch being deactivated (Week 8 Task 1, B3): stock still
   * on its books — any non-zero level, negative included, since that is a
   * discrepancy someone must resolve there — and documents still open at it.
   * Document numbers are capped at `limit` each; the counts are exact.
   */
  async deactivationBlockers(id: string, limit = 3): Promise<{
    materialLevels: number
    finishedGoodLots: number
    productionOrders: { total: number; numbers: string[] }
    receivingReports: { total: number; numbers: string[] }
    conversionOrders: { total: number; numbers: string[] }
    writeOffs:        { total: number; numbers: string[] }
    transfers:        { total: number; numbers: string[] }
  }> {
    const openProduction = { branchId: id, status: { notIn: [ProductionStatus.COMPLETED, ProductionStatus.REJECTED, ProductionStatus.CANCELLED] } }
    const openReceiving  = { branchId: id, status: { in: [RRStatus.DRAFT, RRStatus.PENDING_APPROVAL] } }
    const openConversion = { branchId: id, status: ConversionStatus.PENDING_APPROVAL }
    const openWriteOff   = { branchId: id, status: WriteOffStatus.PENDING_APPROVAL }
    // Either end, pending or in transit (approved, not yet received): the
    // goods are still on their way out of, or into, this branch (T9).
    const openTransfer   = {
      OR:     [{ fromBranchId: id }, { toBranchId: id }],
      status: { in: [TransferStatus.PENDING_APPROVAL, TransferStatus.APPROVED] },
    }
    const oldestFirst    = { createdAt: 'asc' } as const

    const [
      materialLevels, finishedGoodLots,
      productionTotal, production, receivingTotal, receiving,
      conversionTotal, conversions, writeOffTotal, writeOffs,
      transferTotal, transfers,
    ] = await prisma.$transaction([
      prisma.inventoryLevel.count({ where: { branchId: id, quantity: { not: 0 } } }),
      prisma.finishedGoodLevel.count({ where: { branchId: id, quantity: { not: 0 } } }),
      prisma.productionOrder.count({ where: openProduction }),
      prisma.productionOrder.findMany({ where: openProduction, select: { orderNumber: true }, orderBy: oldestFirst, take: limit }),
      prisma.receivingReport.count({ where: openReceiving }),
      prisma.receivingReport.findMany({ where: openReceiving, select: { rrNumber: true }, orderBy: oldestFirst, take: limit }),
      prisma.conversionOrder.count({ where: openConversion }),
      prisma.conversionOrder.findMany({ where: openConversion, select: { orderNumber: true }, orderBy: oldestFirst, take: limit }),
      prisma.writeOff.count({ where: openWriteOff }),
      prisma.writeOff.findMany({ where: openWriteOff, select: { writeOffNumber: true }, orderBy: oldestFirst, take: limit }),
      prisma.stockTransfer.count({ where: openTransfer }),
      prisma.stockTransfer.findMany({ where: openTransfer, select: { transferNumber: true }, orderBy: oldestFirst, take: limit }),
    ])

    return {
      materialLevels,
      finishedGoodLots,
      productionOrders: { total: productionTotal, numbers: production.map(o => o.orderNumber) },
      receivingReports: { total: receivingTotal,  numbers: receiving.map(r => r.rrNumber) },
      conversionOrders: { total: conversionTotal, numbers: conversions.map(c => c.orderNumber) },
      writeOffs:        { total: writeOffTotal,   numbers: writeOffs.map(w => w.writeOffNumber) },
      transfers:        { total: transferTotal,   numbers: transfers.map(t => t.transferNumber) },
    }
  },

  /**
   * Flips isActive, race-safe: the expected current value is in the WHERE, so
   * a second click (or a second admin) gets 'UNCHANGED' rather than a silent
   * no-op. With `keepACommissary` (deactivating an active commissary), refuses
   * with 'LAST_COMMISSARY' when no other active commissary would remain.
   */
  async setActive(
    id: string,
    isActive: boolean,
    keepACommissary: boolean,
  ): Promise<BranchWithManager | 'LAST_COMMISSARY' | 'UNCHANGED'> {
    return prisma.$transaction(async tx => {
      if (keepACommissary) {
        const others = (await lockActiveCommissaries(tx)).filter(other => other !== id)
        if (others.length === 0) return 'LAST_COMMISSARY'
      }
      const { count } = await tx.branch.updateMany({ where: { id, isActive: !isActive }, data: { isActive } })
      if (count === 0) return 'UNCHANGED'
      return tx.branch.findUniqueOrThrow({ where: { id }, include: withManager })
    })
  },

  /** The branch a user manages (Branch.managerId is unique, so at most one). */
  async findManagedBy(userId: string): Promise<{ id: string; name: string } | null> {
    return prisma.branch.findUnique({ where: { managerId: userId }, select: { id: true, name: true } })
  },

  async findProfile(id: string): Promise<BranchWithManager | null> {
    return prisma.branch.findUnique({ where: { id }, include: withManager })
  },
}
