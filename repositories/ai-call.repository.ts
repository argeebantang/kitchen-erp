import { AiCallOutcome, AiFeature, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export type CreateAiCallInput = {
  feature: AiFeature
  outcome: AiCallOutcome
  model: string
  servedModel?: string | null
  userId?: string | null
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  costUsd?: Prisma.Decimal
  durationMs?: number
  requestId?: string | null
  errorType?: string | null
  /** The assistant question this call is a round of (Week 9 Task 4); null for other features. */
  aiQueryId?: string | null
}

const aiCallSummarySelect = {
  id: true, feature: true, outcome: true, model: true, servedModel: true,
  inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true,
  costUsd: true, durationMs: true, errorType: true, createdAt: true,
  user: { select: { name: true } },
} satisfies Prisma.AiCallSelect

export type AiCallSummary = Prisma.AiCallGetPayload<{ select: typeof aiCallSummarySelect }>

export const AiCallRepository = {
  /** Every call is recorded, whatever its outcome (Week 9 Task 1, D4). Append-only. Returns its id, for an insight to point at. */
  async record(input: CreateAiCallInput): Promise<string> {
    const { id } = await prisma.aiCall.create({ data: input, select: { id: true } })
    return id
  },

  /** Estimated spend since a moment — the month so far, for the budget (D5). Served by AiCall(createdAt). */
  async spendSince(since: Date): Promise<Prisma.Decimal> {
    const { _sum } = await prisma.aiCall.aggregate({
      where: { createdAt: { gte: since } },
      _sum:  { costUsd: true },
    })
    return _sum.costUsd ?? new Prisma.Decimal(0)
  },

  /** Spend and call count per feature since a moment. Features with no calls are absent. */
  async spendByFeatureSince(since: Date) {
    // By outcome too, so AI Settings can say how many failed (Week 10 Task 7).
    const groups = await prisma.aiCall.groupBy({
      by:     ['feature', 'outcome'],
      where:  { createdAt: { gte: since } },
      _sum:   { costUsd: true },
      _count: { _all: true },
    })
    const byFeature = new Map<AiFeature, { feature: AiFeature; costUsd: Prisma.Decimal; calls: number; failed: number }>()
    for (const group of groups) {
      const row = byFeature.get(group.feature) ?? { feature: group.feature, costUsd: new Prisma.Decimal(0), calls: 0, failed: 0 }
      row.costUsd = row.costUsd.add(group._sum.costUsd ?? 0)
      row.calls  += group._count._all
      if (group.outcome !== AiCallOutcome.COMPLETED) row.failed += group._count._all
      byFeature.set(group.feature, row)
    }
    return [...byFeature.values()]
  },

  /** The newest calls, newest first; id breaks ties between calls in the same millisecond. */
  async findLatest(take: number): Promise<AiCallSummary[]> {
    return prisma.aiCall.findMany({
      select:  aiCallSummarySelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
    })
  },
}
