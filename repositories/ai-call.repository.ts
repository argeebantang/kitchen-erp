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
}

const aiCallSummarySelect = {
  id: true, feature: true, outcome: true, model: true, servedModel: true,
  inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true,
  costUsd: true, durationMs: true, errorType: true, createdAt: true,
  user: { select: { name: true } },
} satisfies Prisma.AiCallSelect

export type AiCallSummary = Prisma.AiCallGetPayload<{ select: typeof aiCallSummarySelect }>

export const AiCallRepository = {
  /** Every call is recorded, whatever its outcome (Week 9 Task 1, D4). Append-only. */
  async record(input: CreateAiCallInput): Promise<void> {
    await prisma.aiCall.create({ data: input })
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
    const groups = await prisma.aiCall.groupBy({
      by:     ['feature'],
      where:  { createdAt: { gte: since } },
      _sum:   { costUsd: true },
      _count: { _all: true },
    })
    return groups.map(group => ({
      feature: group.feature,
      costUsd: group._sum.costUsd ?? new Prisma.Decimal(0),
      calls:   group._count._all,
    }))
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
