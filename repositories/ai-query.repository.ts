import { AiQueryStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * The assistant's query log (Week 9 Task 4, AiQuery): one row per question,
 * started PENDING before Claude is called and finished once, ANSWERED or
 * FAILED. Its rounds are the AiCall rows that point at it.
 */

/**
 * One tool call as the log keeps it (H2), in the order Claude made them.
 * `input` is what Claude sent, as JSON text; a query's rows are never kept.
 */
export type AiQueryLookupRecord = {
  tool: string
  input: string
  /** What the card showed under "Looked up"; null when the call failed. */
  label: string | null
  sql: string | null
  rowCount: number | null
  truncated: boolean | null
  /** The error Claude was given instead of a result. */
  error: string | null
}

export type StartAiQueryInput = { userId: string; conversationId: string; question: string }

export type FinishAiQueryInput =
  | { status: typeof AiQueryStatus.ANSWERED; answer: string; lookups: AiQueryLookupRecord[]; durationMs: number }
  | { status: typeof AiQueryStatus.FAILED; error: string; lookups: AiQueryLookupRecord[]; durationMs: number }

export type AiQueryListFilter = { userId?: string; conversationId?: string; skip: number; take: number; oldestFirst: boolean }

const aiQueryListSelect = {
  id: true, conversationId: true, question: true, status: true, answer: true, error: true,
  lookups: true, durationMs: true, createdAt: true,
  user: { select: { name: true } },
} satisfies Prisma.AiQuerySelect

export type AiQueryListRow = Prisma.AiQueryGetPayload<{ select: typeof aiQueryListSelect }>

export type AiQueryCallTotals = { aiQueryId: string; rounds: number; costUsd: Prisma.Decimal; inputTokens: number; outputTokens: number }

export const AiQueryRepository = {
  /** Records the question before Claude is called; returns its id for the rounds to point at. */
  async start(input: StartAiQueryInput): Promise<string> {
    const { id } = await prisma.aiQuery.create({ data: input, select: { id: true } })
    return id
  },

  /** PENDING → ANSWERED or FAILED, once: false if it was not PENDING. */
  async finish(id: string, input: FinishAiQueryInput): Promise<boolean> {
    const { count } = await prisma.aiQuery.updateMany({
      where: { id, status: AiQueryStatus.PENDING },
      data: input.status === AiQueryStatus.ANSWERED
        ? { status: input.status, answer: input.answer, lookups: input.lookups, durationMs: input.durationMs }
        : { status: input.status, error: input.error, lookups: input.lookups, durationMs: input.durationMs },
    })
    return count === 1
  },

  /** One page (newest first unless oldestFirst), with the count for paging. Served by (createdAt) / (userId, createdAt) / (conversationId). */
  async list(filter: AiQueryListFilter): Promise<{ rows: AiQueryListRow[]; total: number }> {
    const where: Prisma.AiQueryWhereInput = {
      ...(filter.userId ? { userId: filter.userId } : {}),
      ...(filter.conversationId ? { conversationId: filter.conversationId } : {}),
    }
    const [rows, total] = await prisma.$transaction([
      prisma.aiQuery.findMany({
        where,
        // id breaks ties between questions logged in the same millisecond.
        orderBy: filter.oldestFirst ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: filter.skip,
        take: filter.take,
        select: aiQueryListSelect,
      }),
      prisma.aiQuery.count({ where }),
    ])
    return { rows, total }
  },

  /** Rounds, tokens and cost per question, summed from its AiCall rows (H3) — one groupBy for a page. */
  async callTotals(ids: string[]): Promise<AiQueryCallTotals[]> {
    if (ids.length === 0) return []
    const groups = await prisma.aiCall.groupBy({
      by:     ['aiQueryId'],
      where:  { aiQueryId: { in: ids } },
      _count: { _all: true },
      _sum:   { costUsd: true, inputTokens: true, outputTokens: true },
    })
    return groups.flatMap(group => group.aiQueryId === null ? [] : [{
      aiQueryId:    group.aiQueryId,
      rounds:       group._count._all,
      costUsd:      group._sum.costUsd ?? new Prisma.Decimal(0),
      inputTokens:  group._sum.inputTokens ?? 0,
      outputTokens: group._sum.outputTokens ?? 0,
    }])
  },

  /** Everyone who has asked the assistant, by name — the page's user filter. */
  async askers(): Promise<{ id: string; name: string }[]> {
    return prisma.user.findMany({
      where:   { aiQueries: { some: {} } },
      select:  { id: true, name: true },
      orderBy: { name: 'asc' },
    })
  },
}
