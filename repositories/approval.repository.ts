import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Reads decisions for any workflow document.
 *
 * The (referenceType, referenceId) pair is not a foreign key — Postgres cannot
 * express an FK whose target table varies by row — so this is a plain lookup on
 * two text columns. It is fast because of the @@index([referenceType,
 * referenceId]) added with the table in the Week 3 migration; without it this
 * would be a sequential scan over every approval in the system.
 */
const approverInclude = {
  approver: { select: { id: true, name: true, email: true } },
} satisfies Prisma.ApprovalInclude

export type ApprovalWithApprover = Prisma.ApprovalGetPayload<{
  include: typeof approverInclude
}>

export const ApprovalRepository = {
  /** Newest decision first. A document can be decided more than once over its life. */
  async findByReference(
    referenceType: string,
    referenceId: string,
  ): Promise<ApprovalWithApprover[]> {
    return prisma.approval.findMany({
      where:   { referenceType, referenceId },
      include: approverInclude,
      orderBy: { decidedAt: 'desc' },
    })
  },

  /**
   * How many decisions of one kind were made in [start, end), by decision
   * (Week 11 Task 5: the Procurement report's purchase requests). A document
   * decided twice counts twice — this counts decisions, not documents.
   */
  async decisionCountsBetween(referenceType: string, start: Date, end: Date): Promise<{ decision: string; count: number }[]> {
    const rows = await prisma.approval.groupBy({
      by:     ['decision'],
      where:  { referenceType, decidedAt: { gte: start, lt: end } },
      _count: { _all: true },
    })
    return rows.map(row => ({ decision: row.decision, count: row._count._all }))
  },
}
