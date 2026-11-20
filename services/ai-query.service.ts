import { AiQueryStatus } from '@prisma/client'
import { z } from 'zod'
import { toDecimalString } from '@/lib/decimal'
import { AiQueryRepository, type AiQueryLookupRecord } from '@/repositories/ai-query.repository'

/**
 * The assistant's query log as admins read it (Week 9 Task 4, H7): AI
 * Settings → Assistant questions. Read-only; the assistant writes the log
 * (AssistantService.ask).
 */

export const AI_QUERY_PAGE_SIZE = 50

export type AiQueryLookupDto = AiQueryLookupRecord

export type AiQueryDto = {
  id: string
  /** ISO. */
  createdAt: string
  userName: string
  conversationId: string
  question: string
  status: AiQueryStatus
  answer: string | null
  error: string | null
  lookups: AiQueryLookupDto[]
  /** Null while PENDING. */
  durationMs: number | null
  /** From its AiCall rows: Claude calls made for it, and their estimated cost in USD. */
  rounds: number
  costUsd: string
}

export type AiQueryPageDto = {
  questions: AiQueryDto[]
  total: number
  /** Everyone who has asked, for the user filter. */
  askers: { id: string; name: string }[]
}

// The lookups column is JSON written by AssistantService; checked on the way
// out so an unexpected shape shows as no lookups instead of breaking the page.
const LookupsSchema = z.array(z.object({
  tool:      z.string(),
  input:     z.string(),
  label:     z.string().nullable(),
  sql:       z.string().nullable(),
  rowCount:  z.number().nullable(),
  truncated: z.boolean().nullable(),
  error:     z.string().nullable(),
}))

function lookupsOf(value: unknown): AiQueryLookupDto[] {
  const parsed = LookupsSchema.safeParse(value)
  return parsed.success ? parsed.data : []
}

/** One page of questions, newest first — or one conversation, in the order it was asked — optionally one user's. */
async function list(filter: { userId?: string; conversationId?: string; page: number }): Promise<AiQueryPageDto> {
  const { rows, total } = await AiQueryRepository.list({
    userId:         filter.userId,
    conversationId: filter.conversationId,
    skip:           (filter.page - 1) * AI_QUERY_PAGE_SIZE,
    take:           AI_QUERY_PAGE_SIZE,
    oldestFirst:    filter.conversationId !== undefined,
  })
  const [totals, askers] = await Promise.all([
    AiQueryRepository.callTotals(rows.map(row => row.id)),
    AiQueryRepository.askers(),
  ])

  return {
    total,
    askers,
    questions: rows.map(row => {
      const calls = totals.find(entry => entry.aiQueryId === row.id)
      return {
        id:             row.id,
        createdAt:      row.createdAt.toISOString(),
        userName:       row.user.name,
        conversationId: row.conversationId,
        question:       row.question,
        status:         row.status,
        answer:         row.answer,
        error:          row.error,
        lookups:        lookupsOf(row.lookups),
        durationMs:     row.durationMs,
        rounds:         calls?.rounds ?? 0,
        costUsd:        calls ? toDecimalString(calls.costUsd) : '0',
      }
    }),
  }
}

export const AiQueryService = { list }
