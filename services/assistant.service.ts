import { AiFeature, Role } from '@prisma/client'
import type Anthropic from '@anthropic-ai/sdk'
import { addDays, todayIsoDate, weekStartOf } from '@/lib/dates'
import { AiService, type AiResult, type AiToolCall, type AiToolResult } from '@/services/ai.service'
import { toolsFor, type AssistantTool, type ToolQuery } from '@/services/assistant-tools'

/**
 * FEATURE 2 — the dashboard assistant (Week 9 Task 3,
 * docs/2026-11-19-week9-nl-query.md). A question in English, Filipino or
 * Taglish, answered from the system's own data. The conversation lives on
 * the page (F5): it sends the last few messages with every question and the
 * server keeps nothing.
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

  const lookups = [
    costs && `- For production cost or spending on production ("gastos", "magkano ang nagastos"), use get_production_costs${query ? ', not run_query' : ''}: its figures are the ones on the Costing dashboard. Pick the period the question means; for any other range use custom with from and to. A week runs Monday to Sunday.`,
    query && '- For anything else in the system (stock, materials, prices, suppliers, purchases, deliveries, transfers, lots, write-offs, production orders, recipes, branches, users), use run_query.',
    query
      ? "- If your tools cannot get what a question needs (AI usage, notifications, users' emails or passwords), say plainly that you cannot look that up."
      : `- You can look up ${costs ? 'production costs only' : 'nothing in the system yet'}. For anything else (stock, purchases, users and so on), say plainly that you cannot look that up yet, and do not guess.`,
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
 * Runs the tool Claude asked for, if this viewer was offered it, and notes
 * what it looked up for "Looked up: …". Errors go back to Claude to correct.
 */
function toolRunner(tools: AssistantTool[], viewer: AssistantViewer, lookups: AssistantLookupDto[]) {
  return async ({ name, input }: AiToolCall): Promise<AiToolResult> => {
    const tool = tools.find(candidate => candidate.definition.name === name)
    if (!tool) return { content: `There is no tool called ${name}.`, isError: true }
    const outcome = await tool.run(input, viewer)
    if (!outcome.ok) return { content: outcome.error, isError: true }
    const seen = lookups.some(lookup => lookup.label === outcome.label && lookup.query?.sql === outcome.query?.sql)
    if (!seen) lookups.push({ tool: name, label: outcome.label, query: outcome.query })
    return { content: JSON.stringify(outcome.data), isError: false }
  }
}

/** Answers the last message of the conversation. The route has checked its shape. */
async function ask(messages: AssistantMessage[], viewer: AssistantViewer): Promise<AiResult<AssistantAnswerDto>> {
  const tools = toolsFor(viewer.role)
  const lookups: AssistantLookupDto[] = []
  const result = await AiService.converse({
    feature:      AiFeature.ASSISTANT,
    instructions: instructionsFor(tools),
    context:      context(todayIsoDate()),
    messages:     conversation(messages),
    tools:        tools.map(tool => tool.definition),
    runTool:      toolRunner(tools, viewer, lookups),
    maxRounds:    ASSISTANT_MAX_ROUNDS,
    userId:       viewer.userId,
  })
  if (!result.success) return result

  return {
    success: true,
    data: { answer: result.data.text, lookups, costUsd: result.data.costUsd },
  }
}

export const AssistantService = { ask }
