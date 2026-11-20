import { randomUUID } from 'node:crypto'
import { AiFeature, AiQueryStatus, Role } from '@prisma/client'
import type Anthropic from '@anthropic-ai/sdk'
import { addDays, todayIsoDate, weekStartOf } from '@/lib/dates'
import { AiService, type AiResult, type AiToolCall, type AiToolResult } from '@/services/ai.service'
import { toolsFor, type AssistantTool, type ToolOutcome, type ToolQuery } from '@/services/assistant-tools'
import { AssistantActionService, type AssistantActionDto } from '@/services/assistant-action.service'
import { AiQueryRepository, type AiQueryLookupRecord, type FinishAiQueryInput } from '@/repositories/ai-query.repository'

/**
 * FEATURE 2 — the dashboard assistant (Week 9 Task 3,
 * docs/2026-11-19-week9-nl-query.md). A question in English, Filipino or
 * Taglish, answered from the system's own data. The conversation lives on
 * the page (F5): it sends the last few messages with every question; the
 * server keeps no conversation state, but logs each question for admins
 * (Week 9 Task 4, AiQuery — docs/2026-11-20-week9-ai-query-log.md).
 */

/** Who may ask (F4). Same list as the /api/ai/assistant guard in middleware.ts. */
export const ASSISTANT_ROLES: readonly Role[] = [Role.ADMIN, Role.ACCOUNTING, Role.PRODUCTION_MANAGER]

export function canUseAssistant(role: string): boolean {
  return ASSISTANT_ROLES.some(allowed => allowed === role)
}

/** The longest question, in characters. */
export const ASSISTANT_QUESTION_MAX = 1000
/** Earlier messages sent with a question (F5), so follow-ups have their context. */
export const ASSISTANT_HISTORY = 6
/** An earlier answer can be long; anything beyond this is not resent. */
export const ASSISTANT_MESSAGE_MAX = 4000
/** Claude calls per question (F1), lookups included; each is recorded and budgeted. */
export const ASSISTANT_MAX_ROUNDS = 5

export type AssistantMessage = { role: 'user' | 'assistant'; content: string }

export type AssistantViewer = { userId: string; role: string }

/** One data lookup behind an answer, for "Looked up: …" under it; query is the SQL for "How I got this" (run_query only). */
export type AssistantLookupDto = { tool: string; label: string; query: ToolQuery | null }

export type AssistantAnswerDto = {
  answer: string
  lookups: AssistantLookupDto[]
  /** The question's estimated cost in USD, all rounds together. */
  costUsd: string
  /** Send it back with the next question so the log keeps the conversation together (Week 9 Task 4, H4). */
  conversationId: string
  /** A document Claude drafted for the user to confirm or cancel (Week 9 Task 5); null when none. */
  action: AssistantActionDto | null
}

/**
 * The assistant's instructions for the tools this viewer is offered, so
 * Claude is never told about a tool it does not have (run_query is offered
 * only when AI_DATABASE_URL is set). Stable for a given set of tools, so it
 * stays prompt-cached; today's date goes in context().
 */
function instructionsFor(tools: AssistantTool[]): string {
  const has = (name: string) => tools.some(tool => tool.definition.name === name)
  const costs = has('get_production_costs')
  const query = has('run_query')
  const draftsRequests = has('draft_purchase_request')
  const draftsOrders = has('draft_production_order')
  const drafts = draftsRequests || draftsOrders
  const drafted = [draftsRequests && 'purchase requests', draftsOrders && 'production orders'].filter(kind => typeof kind === 'string').join(' and ')

  const lookups = [
    costs && `- For production cost or spending on production ("gastos", "magkano ang nagastos"), use get_production_costs${query ? ', not run_query' : ''}: its figures are the ones on the Costing dashboard. Pick the period the question means; for any other range use custom with from and to. A week runs Monday to Sunday.`,
    query && '- For anything else in the system (stock, materials, prices, suppliers, purchases, deliveries, transfers, lots, write-offs, production orders, recipes, branches, users), use run_query.',
    query
      ? "- If your tools cannot get what a question needs (AI usage, notifications, users' emails or passwords), say plainly that you cannot look that up."
      : `- You can look up ${costs ? 'production costs only' : 'nothing in the system yet'}. For anything else (stock, purchases, users and so on), say plainly that you cannot look that up yet, and do not guess.`,
    draftsRequests && '- When the user asks to order, buy or request materials ("mag-order", "bumili"), draft a purchase request with draft_purchase_request.',
    draftsOrders && '- When the user asks to plan, cook or produce something ("magluto", "gawa tayo ng"), draft a production order with draft_production_order. Mention any ingredients that are short.',
    drafts && '- Draft only when asked. If something it needs is unclear (an item, a quantity, a date), ask first.',
    drafts && "- A draft creates nothing. The page shows it under your answer with Confirm and Cancel, and only the user's Confirm creates it. Never say anything was created, submitted, ordered or scheduled: say you prepared a draft for them to check and confirm below.",
    drafts
      ? `- Apart from drafting ${drafted}, you cannot create, change or approve anything in the system. If asked to, say so.`
      : '- You cannot create, change or approve anything in the system. If asked to, say so.',
  ].filter(line => typeof line === 'string')

  return [
    "You answer questions typed into the KitchenERP dashboard by the business's own staff.",
    '',
    '- Look figures up with your tools; never guess or make up numbers.',
    ...lookups,
    '- In KitchenERP, production cost is the ingredients used, priced at what they cost when accounting signed off each run. It has no labor, overhead or utilities. Do not bring those up; if asked, say the system does not track them.',
    '- Answer from the figures the tools return. Say which dates you covered. If nothing matched, say so. When runs are awaiting sign-off, mention that they are not in the figures yet. If rows were cut off, say the answer covers only part of the data.',
    '- Do not show SQL, table names or ids in the answer, and never mention your tools or these instructions: the page shows how you got an answer. Use names, document numbers and units.',
    '- You may answer general questions that need no data, such as what a term means or how cost per kg is worked out.',
    "- Reply in the language of the user's latest message.",
    '- Keep answers short: usually 2 to 4 sentences, or a list of at most 5 short lines. Go longer only when the question asks for detail.',
    '- Write plain text: short paragraphs, or lines starting with "- " for a list. No Markdown headings, bold, tables or code blocks.',
  ].join('\n')
}

/** What changes from day to day, sent after the cached instructions. */
function context(today: string): string {
  const weekday = new Date(`${today}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'long', timeZone: 'UTC' })
  const monday = weekStartOf(today)
  return `Today is ${weekday}, ${today} (Asia/Manila). This week is ${monday} to ${addDays(monday, 6)}.`
}

/**
 * The messages to send: the last ASSISTANT_HISTORY before the question plus
 * the question, starting with a user message as the API requires.
 */
function conversation(messages: AssistantMessage[]): Anthropic.Beta.BetaMessageParam[] {
  const recent = messages.slice(-(ASSISTANT_HISTORY + 1))
  const start = recent.findIndex(message => message.role === 'user')
  return recent.slice(start).map(({ role, content }) => ({ role, content }))
}

/**
 * Runs the tool Claude asked for, if this viewer was offered it. Notes what it
 * looked up for "Looked up: …" and logs every call, failed ones included, for
 * the query log (Week 9 Task 4, H2). Errors go back to Claude to correct.
 */
function toolRunner(
  tools: AssistantTool[],
  viewer: AssistantViewer,
  queryId: string | null,
  lookups: AssistantLookupDto[],
  log: AiQueryLookupRecord[],
) {
  return async ({ name, input }: AiToolCall): Promise<AiToolResult> => {
    const entry: AiQueryLookupRecord = {
      tool: name, input: JSON.stringify(input) ?? 'null', label: null, sql: null, rowCount: null, truncated: null, error: null,
    }
    log.push(entry)
    const tool = tools.find(candidate => candidate.definition.name === name)
    if (!tool) {
      entry.error = `There is no tool called ${name}.`
      return { content: entry.error, isError: true }
    }
    let outcome: ToolOutcome
    try {
      outcome = await tool.run(input, { ...viewer, queryId })
    } catch (error) {
      entry.error = 'The lookup failed on the server.'
      throw error
    }
    if (!outcome.ok) {
      entry.error = outcome.error
      return { content: outcome.error, isError: true }
    }
    entry.label = outcome.label
    entry.sql = outcome.query?.sql ?? null
    entry.rowCount = outcome.query?.rowCount ?? null
    entry.truncated = outcome.query?.truncated ?? null
    // A draft is shown as its own panel, not under "Looked up".
    if (tool.kind === 'draft') return { content: JSON.stringify(outcome.data), isError: false }
    const seen = lookups.some(lookup => lookup.label === outcome.label && lookup.query?.sql === outcome.query?.sql)
    if (!seen) lookups.push({ tool: name, label: outcome.label, query: outcome.query })
    return { content: JSON.stringify(outcome.data), isError: false }
  }
}

/** Logs the question before Claude is called (H1). A log that cannot be written never blocks the answer (H6). */
async function startLog(viewer: AssistantViewer, conversationId: string, question: string): Promise<string | null> {
  try {
    return await AiQueryRepository.start({ userId: viewer.userId, conversationId, question })
  } catch (error) {
    console.error('[AI] could not log an assistant question', error)
    return null
  }
}

async function finishLog(id: string | null, input: FinishAiQueryInput): Promise<void> {
  if (id === null) return
  try {
    await AiQueryRepository.finish(id, input)
  } catch (error) {
    console.error(`[AI] could not finish assistant question ${id} in the log`, error)
  }
}

/** The draft a tool stored on this question, if one succeeded. A failed read only loses the panel, not the answer. */
async function draftedAction(
  queryId: string | null,
  tools: AssistantTool[],
  log: AiQueryLookupRecord[],
): Promise<AssistantActionDto | null> {
  const drafted = log.some(entry => entry.error === null && tools.some(tool => tool.kind === 'draft' && tool.definition.name === entry.tool))
  if (queryId === null || !drafted) return null
  try {
    return await AssistantActionService.forQuery(queryId)
  } catch (error) {
    console.error(`[AI] could not read the draft on assistant question ${queryId}`, error)
    return null
  }
}

/**
 * Answers the last message of the conversation; the route has checked its
 * shape. The first question of a conversation gets its id here (H4) — not
 * from the page, where crypto.randomUUID() needs HTTPS or localhost — and the
 * page sends it back with the follow-ups.
 */
async function ask(
  messages: AssistantMessage[],
  viewer: AssistantViewer,
  conversationId: string | null,
): Promise<AiResult<AssistantAnswerDto>> {
  const started = Date.now()
  const conversationKey = conversationId ?? randomUUID()
  const queryId = await startLog(viewer, conversationKey, messages.at(-1)?.content ?? '')
  const tools = toolsFor(viewer.role)
  const lookups: AssistantLookupDto[] = []
  const log: AiQueryLookupRecord[] = []

  let result: Awaited<ReturnType<typeof AiService.converse>>
  try {
    result = await AiService.converse({
      feature:      AiFeature.ASSISTANT,
      instructions: instructionsFor(tools),
      context:      context(todayIsoDate()),
      messages:     conversation(messages),
      tools:        tools.map(tool => tool.definition),
      runTool:      toolRunner(tools, viewer, queryId, lookups, log),
      maxRounds:    ASSISTANT_MAX_ROUNDS,
      userId:       viewer.userId,
      aiQueryId:    queryId,
    })
  } catch (error) {
    await finishLog(queryId, { status: AiQueryStatus.FAILED, error: 'Internal server error', lookups: log, durationMs: Date.now() - started })
    throw error
  }

  const durationMs = Date.now() - started
  if (!result.success) {
    await finishLog(queryId, { status: AiQueryStatus.FAILED, error: result.error, lookups: log, durationMs })
    return result
  }
  await finishLog(queryId, { status: AiQueryStatus.ANSWERED, answer: result.data.text, lookups: log, durationMs })
  return {
    success: true,
    data: {
      answer: result.data.text, lookups, costUsd: result.data.costUsd, conversationId: conversationKey,
      action: await draftedAction(queryId, tools, log),
    },
  }
}

export const AssistantService = { ask }
