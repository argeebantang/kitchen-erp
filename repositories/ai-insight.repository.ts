import { AiInsightStatus, AiInsightType, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export type AiInsightReference = {
  type: AiInsightType
  referenceType: string
  referenceId: string
}

const insightSelect = {
  id: true, status: true, content: true, model: true, error: true, generatedAt: true, updatedAt: true,
  aiCall: { select: { costUsd: true } },
} satisfies Prisma.AiInsightSelect

export type AiInsightSummary = Prisma.AiInsightGetPayload<{ select: typeof insightSelect }>

function key({ type, referenceType, referenceId }: AiInsightReference) {
  return { type_referenceType_referenceId: { type, referenceType, referenceId } }
}

/**
 * Stored AI output (Week 9 Task 2, E3). Status moves are race-safe like
 * every other status in the app: the expected status is in the UPDATE's
 * WHERE, and 0 rows means someone else moved it first.
 */
export const AiInsightRepository = {
  async find(ref: AiInsightReference): Promise<AiInsightSummary | null> {
    return prisma.aiInsight.findUnique({ where: key(ref), select: insightSelect })
  },

  /**
   * Asks for an insight: creates it PENDING, or puts a FAILED one back to
   * PENDING. False when one is already PENDING or READY — the caller then
   * queues nothing, so two clicks or a retry cannot produce two calls.
   */
  async request(ref: AiInsightReference): Promise<boolean> {
    const retried = await prisma.aiInsight.updateMany({
      where: { ...ref, status: AiInsightStatus.FAILED },
      data:  { status: AiInsightStatus.PENDING, error: null },
    })
    if (retried.count === 1) return true
    // INSERT … ON CONFLICT DO NOTHING on the unique key: 0 rows when it exists
    // already (PENDING or READY), with no error for Prisma to log.
    const created = await prisma.aiInsight.createMany({
      data: [{ ...ref, status: AiInsightStatus.PENDING }],
      skipDuplicates: true,
    })
    return created.count === 1
  },

  /**
   * Regenerate (Week 10 Task 2, P2): READY → PENDING, keeping the text, facts
   * and call it was written from, so the page goes on showing them while the
   * new one is written. False when it is not READY — a PENDING one is already
   * being written, so a second click queues nothing.
   */
  async regenerate(ref: AiInsightReference): Promise<boolean> {
    const { count } = await prisma.aiInsight.updateMany({
      where: { ...ref, status: AiInsightStatus.READY },
      data:  { status: AiInsightStatus.PENDING, error: null },
    })
    return count === 1
  },

  /** PENDING → READY with the text and what produced it. False if it was no longer PENDING. */
  async complete(ref: AiInsightReference, result: {
    content: string; facts: Prisma.InputJsonValue; prompt: string; model: string; aiCallId: string | null
  }): Promise<boolean> {
    const { count } = await prisma.aiInsight.updateMany({
      where: { ...ref, status: AiInsightStatus.PENDING },
      data:  { ...result, status: AiInsightStatus.READY, error: null, generatedAt: new Date() },
    })
    return count === 1
  },

  /**
   * A PENDING insight's attempt failed. A regenerate (it still has the earlier
   * text) goes back to READY with that text and its facts untouched, and the
   * reason in `error` — the page says the new one could not be written. A
   * first attempt goes to FAILED, keeping the facts and prompt to see what was
   * tried. False if it was no longer PENDING.
   */
  async fail(ref: AiInsightReference, result: {
    error: string; facts?: Prisma.InputJsonValue; prompt?: string; aiCallId?: string | null
  }): Promise<boolean> {
    const kept = await prisma.aiInsight.updateMany({
      where: { ...ref, status: AiInsightStatus.PENDING, content: { not: null } },
      data:  { status: AiInsightStatus.READY, error: result.error },
    })
    if (kept.count === 1) return true
    const { count } = await prisma.aiInsight.updateMany({
      where: { ...ref, status: AiInsightStatus.PENDING },
      data:  { ...result, status: AiInsightStatus.FAILED },
    })
    return count === 1
  },
}
