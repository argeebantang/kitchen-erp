import Anthropic from '@anthropic-ai/sdk'
import { AiFeature, AiCallOutcome, AiInsightStatus, Prisma } from '@prisma/client'
import { config } from '@/lib/config'
import { AI_FEATURES, getClaude, isAiConfigured, MODEL_PRICES, type AiEffort, type ModelPrice } from '@/lib/claude'
import { businessDayRange, isoDateAt } from '@/lib/dates'
import { toDecimalString } from '@/lib/decimal'
import { AiCallRepository } from '@/repositories/ai-call.repository'
import type { AiInsightSummary } from '@/repositories/ai-insight.repository'

/**
 * The one door to Claude for every AI feature (Week 9 Task 1). Callers never
 * touch the SDK client: this service checks the budget, makes the call,
 * records it and turns failures into a result.
 */

export type AiFailure = {
  success: false
  error: string
  status: number
  /**
   * Worth trying again later — rate limited, overloaded, unreachable, timed
   * out. A background job retries these; not set up, over budget, a refusal
   * or a rejected key would fail the same way again (Week 9 Task 2, E4).
   */
  retryable: boolean
  /** The AiCall row this attempt wrote; null when nothing was recorded (not set up). */
  callId: string | null
}

export type AiResult<T> = { success: true; data: T } | AiFailure

/**
 * Shared by every feature, ahead of its own instructions (D7). Kept stable —
 * no dates or ids — so it can be prompt-cached once a feature's prompts are
 * long enough to be worth it.
 */
export const BASE_SYSTEM_PROMPT = `You are KitchenAI, the assistant built into KitchenERP — the inventory, production and costing system of Lydia's Lechon, a lechon business in the Philippines with a commissary kitchen that supplies its outlet branches.

- Money is in Philippine pesos; write amounts like ₱1,905.50. Dates and times are Asia/Manila.
- Use only the figures the system gives you. If something you need is missing, say what is missing instead of estimating it.
- Reply in the language the user writes in: English, Filipino or Taglish. When there is no user question to match, write in English.
- Be brief and concrete. Your readers run a kitchen, buy supplies and keep the books.`

/** Server-side refusal fallback (D8): a request a safety filter declines is rerun on Anthropic's recommended model in the same call. */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

export type AiCompleteInput = {
  feature: AiFeature
  /** The feature's own instructions, sent after BASE_SYSTEM_PROMPT. */
  instructions: string
  messages: Anthropic.Beta.BetaMessageParam[]
  /** Who asked; null for a background job. */
  userId: string | null
  /**
   * Structured output (Week 10 Task 2): the answer is JSON valid against this
   * schema (output_config.format). The text still comes back as `text`; the
   * feature parses and checks it.
   */
  format?: Anthropic.Beta.BetaJSONOutputFormat
}

export type AiCompletion = {
  text: string
  /** The model that answered — the fallback's after a refusal. */
  servedModel: string
  inputTokens: number
  outputTokens: number
  costUsd: string
  durationMs: number
  /** The AiCall row that recorded it. */
  callId: string
}

export type AiUsageEstimate = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: Prisma.Decimal
}

const PER_MILLION = new Prisma.Decimal(1_000_000)

function priceOf(model: string, requestedModel: string): ModelPrice {
  const price = MODEL_PRICES[model] ?? MODEL_PRICES[requestedModel]
  // A model missing from the table would make every call look free and the budget never trip.
  if (!price) throw new Error(`[AI] No price for model ${model}; add it to MODEL_PRICES in lib/claude.ts`)
  if (!MODEL_PRICES[model]) console.warn(`[AI] No price for ${model}; estimated at ${requestedModel}'s`)
  return price
}

/**
 * Tokens and estimated cost of one response (D6). `usage.iterations` is the
 * source of truth when present: one entry per attempt — a declined attempt
 * and the fallback that answered — each priced at the model that ran it. The
 * top-level usage covers only the attempt that answered. Counting a declined
 * attempt that Anthropic may not bill errs on the side of the budget.
 */
function estimateUsage(message: Anthropic.Beta.BetaMessage, requestedModel: string): AiUsageEstimate {
  const attempts = (message.usage.iterations ?? []).map(entry => ({
    model: 'model' in entry && entry.model ? entry.model : message.model,
    input: entry.input_tokens,
    output: entry.output_tokens,
    cacheRead: entry.cache_read_input_tokens ?? 0,
    cacheWrite: entry.cache_creation_input_tokens ?? 0,
  }))
  if (attempts.length === 0) {
    attempts.push({
      model: message.model,
      input: message.usage.input_tokens,
      output: message.usage.output_tokens,
      cacheRead: message.usage.cache_read_input_tokens ?? 0,
      cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
    })
  }

  return attempts.reduce<AiUsageEstimate>((total, attempt) => {
    const price = priceOf(attempt.model, requestedModel)
    const cost = new Prisma.Decimal(attempt.input).mul(price.input)
      .add(new Prisma.Decimal(attempt.output).mul(price.output))
      .add(new Prisma.Decimal(attempt.cacheRead).mul(price.cacheRead))
      .add(new Prisma.Decimal(attempt.cacheWrite).mul(price.cacheWrite))
      .div(PER_MILLION)
    return {
      inputTokens:      total.inputTokens + attempt.input,
      outputTokens:     total.outputTokens + attempt.output,
      cacheReadTokens:  total.cacheReadTokens + attempt.cacheRead,
      cacheWriteTokens: total.cacheWriteTokens + attempt.cacheWrite,
      costUsd:          total.costUsd.add(cost),
    }
  }, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: new Prisma.Decimal(0) })
}

type ApiFailure = { status: number; error: string; errorType: string; retryable: boolean }

/** The API's own error message, e.g. "Your credit balance is too low…" — what an admin needs on AI Settings. */
function apiErrorMessage(error: InstanceType<typeof Anthropic.APIError>): string | null {
  const body = error.error
  if (typeof body !== 'object' || body === null || !('error' in body)) return null
  const detail = body.error
  if (typeof detail !== 'object' || detail === null || !('message' in detail)) return null
  return typeof detail.message === 'string' ? detail.message : null
}

/**
 * An SDK error as the user sees it and AI Settings records it (D9). Checked
 * most specific first: OverloadedError is an InternalServerError, a timeout is
 * a connection error. The SDK has already retried what is retryable twice.
 * Labels are written out because class names do not survive minification.
 * Null for anything not from the SDK — a bug, left to the route's catch.
 */
function describeApiError(error: unknown): ApiFailure | null {
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return { status: 503, error: 'The AI service took too long to answer. Try again.', errorType: 'Timeout', retryable: true }
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { status: 503, error: 'Could not reach the AI service. Check the internet connection and try again.', errorType: 'ConnectionError', retryable: true }
  }
  if (!(error instanceof Anthropic.APIError)) return null

  const detail = apiErrorMessage(error)
  const withDetail = (label: string) => (detail ? `${label}: ${detail}` : label).slice(0, 300)

  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return { status: 502, error: 'The AI service rejected the API key. An admin needs to check ANTHROPIC_API_KEY.', errorType: withDetail('AuthenticationError'), retryable: false }
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { status: 429, error: 'The AI service is busy. Try again in a minute.', errorType: withDetail('RateLimitError'), retryable: true }
  }
  if (error instanceof Anthropic.OverloadedError) {
    return { status: 503, error: 'The AI service is overloaded right now. Try again shortly.', errorType: 'OverloadedError', retryable: true }
  }
  if (error instanceof Anthropic.InternalServerError) {
    return { status: 503, error: 'The AI service had a problem. Try again shortly.', errorType: withDetail(`ServerError ${error.status}`), retryable: true }
  }
  // 400s land here — including "credit balance too low", which only the detail tells apart.
  return { status: 502, error: 'The AI service refused the request. An admin can see why on AI Settings.', errorType: withDetail(`APIError ${error.status ?? ''}`.trim()), retryable: false }
}

/** How many calls AI Settings lists. */
export const LATEST_AI_CALLS = 20

export type AiFeatureOverviewDto = {
  feature: AiFeature
  label: string
  model: string
  effort: AiEffort
  maxTokens: number
  spentUsd: string
  calls: number
  /** Of the calls, those that did not complete — refused, cut off, errors, over budget (Week 10 Task 7). */
  failed: number
  /** spentUsd ÷ calls; null with no calls. */
  averageUsd: string | null
}

export type AiCallDto = {
  id: string
  featureLabel: string
  outcome: AiCallOutcome
  model: string
  /** Set only when a model other than the one asked for answered (a refusal fallback, D8). */
  fallbackModel: string | null
  /** Null for a background job. */
  userName: string | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: string
  durationMs: number
  errorType: string | null
  createdAt: string
}

export type AiOverviewDto = {
  /** Whether ANTHROPIC_API_KEY is set — never the key itself. */
  configured: boolean
  monthlyBudgetUsd: string
  /** YYYY-MM-DD, the first of this Manila month: when the budget started counting. */
  monthStart: string
  spentThisMonthUsd: string
  /** 0–100, for the bar; 100 once the budget is used up (or is 0). */
  budgetUsedPercent: number
  features: AiFeatureOverviewDto[]
  latestCalls: AiCallDto[]
}

/**
 * The start of the Manila calendar month a moment falls in — when the monthly
 * budget resets (D5). The Console's own limit may reset on UTC; the 8 hours
 * between them do not matter, since the Console limit is set higher.
 */
function monthStartAt(moment: Date): { date: string; instant: Date } {
  const date = `${isoDateAt(moment).slice(0, 7)}-01`
  return { date, instant: businessDayRange(date).start }
}

function budgetUsedPercent(spent: Prisma.Decimal, budget: Prisma.Decimal): number {
  if (budget.lessThanOrEqualTo(0)) return 100
  return Math.min(100, spent.div(budget).mul(100).toDecimalPlaces(1).toNumber())
}

/** AI Settings: set up or not, each feature's settings and spend, and the month against the budget. */
async function overview(now = new Date()): Promise<AiOverviewDto> {
  const month = monthStartAt(now)
  const [spent, byFeature, latest] = await Promise.all([
    AiCallRepository.spendSince(month.instant),
    AiCallRepository.spendByFeatureSince(month.instant),
    AiCallRepository.findLatest(LATEST_AI_CALLS),
  ])
  const budget = new Prisma.Decimal(config.aiMonthlyBudgetUsd)
  const features = Object.values(AiFeature)

  return {
    configured:        isAiConfigured(),
    monthlyBudgetUsd:  config.aiMonthlyBudgetUsd,
    monthStart:        month.date,
    spentThisMonthUsd: toDecimalString(spent),
    budgetUsedPercent: budgetUsedPercent(spent, budget),
    features: features.map(feature => {
      const spend = byFeature.find(row => row.feature === feature)
      return {
        feature,
        ...AI_FEATURES[feature],
        spentUsd:   toDecimalString(spend?.costUsd ?? new Prisma.Decimal(0)),
        calls:      spend?.calls ?? 0,
        failed:     spend?.failed ?? 0,
        averageUsd: spend && spend.calls > 0 ? toDecimalString(spend.costUsd.div(spend.calls)) : null,
      }
    }),
    latestCalls: latest.map(call => ({
      id:               call.id,
      featureLabel:     AI_FEATURES[call.feature].label,
      outcome:          call.outcome,
      model:            call.model,
      fallbackModel:    call.servedModel !== null && call.servedModel !== call.model ? call.servedModel : null,
      userName:         call.user?.name ?? null,
      inputTokens:      call.inputTokens,
      outputTokens:     call.outputTokens,
      cacheReadTokens:  call.cacheReadTokens,
      cacheWriteTokens: call.cacheWriteTokens,
      costUsd:          toDecimalString(call.costUsd),
      durationMs:       call.durationMs,
      errorType:        call.errorType,
      createdAt:        call.createdAt.toISOString(),
    })),
  }
}

type RoundInput = {
  feature: AiFeature
  userId: string | null
  system: Anthropic.Beta.BetaTextBlockParam[]
  messages: Anthropic.Beta.BetaMessageParam[]
  /** Offered to Claude with tool_choice auto — forcing a tool is a 400 on Sonnet 5.5. */
  tools?: Anthropic.Beta.BetaTool[]
  /** Automatic caching of the growing conversation, for a tool loop's later rounds. */
  cacheTail?: boolean
  /** The assistant question this round belongs to (Week 9 Task 4), recorded on its AiCall. */
  aiQueryId?: string | null
  /** Structured output, see AiCompleteInput. */
  format?: Anthropic.Beta.BetaJSONOutputFormat
}

type RoundSuccess = { message: Anthropic.Beta.BetaMessage; usage: AiUsageEstimate; durationMs: number; callId: string }

/**
 * One Claude call for a feature (D1): budget check → call with the refusal
 * fallback → stop_reason → estimated cost → an AiCall row for every outcome
 * except "not set up" (nothing was attempted). A refusal or a cut-off answer
 * is a failure. Every round of a tool loop is one of these.
 */
async function round(input: RoundInput): Promise<AiResult<RoundSuccess>> {
  const client = getClaude()
  if (!client) {
    return { success: false, status: 503, error: 'AI is not set up yet: an admin needs to add the API key on the server.', retryable: false, callId: null }
  }

  const settings = AI_FEATURES[input.feature]
  const call = { feature: input.feature, model: settings.model, userId: input.userId, aiQueryId: input.aiQueryId ?? null }

  // Soft cap (D5). Two calls at once can both pass and overshoot by a call's
  // cost; the Console's spend limit, set higher, is the hard stop.
  const spent = await AiCallRepository.spendSince(monthStartAt(new Date()).instant)
  if (spent.greaterThanOrEqualTo(config.aiMonthlyBudgetUsd)) {
    const callId = await AiCallRepository.record({ ...call, outcome: AiCallOutcome.OVER_BUDGET })
    return { success: false, status: 429, error: "This month's AI budget is used up. AI features are paused until next month.", retryable: false, callId }
  }

  const started = Date.now()
  let message: Anthropic.Beta.BetaMessage
  let requestId: string | null
  try {
    // withResponse() also hands back Anthropic's request id, for a support ticket.
    const response = await client.beta.messages.create({
      model:         settings.model,
      max_tokens:    settings.maxTokens,
      thinking:      { type: 'adaptive' },
      output_config: { effort: settings.effort, ...(input.format ? { format: input.format } : {}) },
      system:        input.system,
      messages:      input.messages,
      ...(input.tools && input.tools.length > 0 ? { tools: input.tools } : {}),
      ...(input.cacheTail ? { cache_control: { type: 'ephemeral' } } : {}),
      betas:     [FALLBACK_BETA],
      fallbacks: 'default',
    }).withResponse()
    message = response.data
    requestId = response.request_id ?? null
  } catch (error) {
    const failure = describeApiError(error)
    if (!failure) throw error
    const callId = await AiCallRepository.record({
      ...call,
      outcome:    AiCallOutcome.ERROR,
      durationMs: Date.now() - started,
      requestId:  error instanceof Anthropic.APIError ? error.requestID ?? null : null,
      errorType:  failure.errorType,
    })
    return { success: false, status: failure.status, error: failure.error, retryable: failure.retryable, callId }
  }

  const durationMs = Date.now() - started
  const usage = estimateUsage(message, settings.model)
  // Read stop_reason before content: a refusal can arrive with partial or no text.
  const outcome = message.stop_reason === 'refusal' ? AiCallOutcome.REFUSED
    : message.stop_reason === 'max_tokens' ? AiCallOutcome.MAX_TOKENS
    : AiCallOutcome.COMPLETED

  const callId = await AiCallRepository.record({
    ...call,
    outcome,
    servedModel: message.model,
    ...usage,
    durationMs,
    requestId,
    errorType:   outcome === AiCallOutcome.REFUSED ? `refusal: ${message.stop_details?.category ?? 'unspecified'}` : null,
  })

  if (outcome === AiCallOutcome.REFUSED) {
    return { success: false, status: 400, error: 'The AI declined to answer this request.', retryable: false, callId }
  }
  if (outcome === AiCallOutcome.MAX_TOKENS) {
    return { success: false, status: 502, error: 'The AI answer was cut off before it finished. Try a narrower request.', retryable: false, callId }
  }
  return { success: true, data: { message, usage, durationMs, callId } }
}

function textOf(message: Anthropic.Beta.BetaMessage): string {
  return message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')
}

/** One Claude call with no tools, for an answer of a few thousand tokens at most. */
async function complete(input: AiCompleteInput): Promise<AiResult<AiCompletion>> {
  const result = await round({
    feature:  input.feature,
    userId:   input.userId,
    system:   [{ type: 'text', text: BASE_SYSTEM_PROMPT }, { type: 'text', text: input.instructions }],
    messages: input.messages,
    format:   input.format,
  })
  if (!result.success) return result

  const { message, usage, durationMs, callId } = result.data
  return {
    success: true,
    data: {
      text:         textOf(message),
      servedModel:  message.model,
      inputTokens:  usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd:      toDecimalString(usage.costUsd),
      durationMs,
      callId,
    },
  }
}

/** A tool Claude asked to run: the name it chose and its input, unchecked (model output). */
export type AiToolCall = { name: string; input: unknown }
/** What goes back to Claude. An error is shown to it as one, so it can correct its input or say what it could not find. */
export type AiToolResult = { content: string; isError: boolean }

export type AiConverseInput = AiCompleteInput & {
  /** Changes with every request (today's date…): sent after the cached instructions, so it does not break the cache. */
  context: string
  tools: Anthropic.Beta.BetaTool[]
  runTool(call: AiToolCall): Promise<AiToolResult>
  /** Claude calls before giving up; each one is recorded and counted toward the budget. */
  maxRounds: number
  /** The logged question (AiQuery) every round's AiCall points at; null when it could not be logged. */
  aiQueryId: string | null
}

export type AiConversation = {
  text: string
  rounds: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  /** All rounds together. */
  costUsd: string
  durationMs: number
}

/**
 * A question that may need lookups (Week 9 Task 3, F1): our own loop rather
 * than the SDK's beta Tool Runner, so every round goes through round() —
 * budget check, AiCall row, error mapping. Claude answers, or asks for one or
 * more tools; those run and their results go back in one user message, and
 * Claude is called again, up to maxRounds. A failed round fails the question;
 * the rounds before it stay recorded, since they were spent.
 */
async function converse(input: AiConverseInput): Promise<AiResult<AiConversation>> {
  // Tools, base prompt and instructions are the same for every question:
  // a breakpoint after them lets every user's first round read them from cache.
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: BASE_SYSTEM_PROMPT },
    { type: 'text', text: input.instructions, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: input.context },
  ]
  const messages = [...input.messages]
  const total = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: new Prisma.Decimal(0), durationMs: 0 }

  for (let rounds = 1; rounds <= input.maxRounds; rounds++) {
    const result = await round({
      feature: input.feature,
      userId:  input.userId,
      system,
      messages,
      tools:   input.tools,
      cacheTail: true,
      aiQueryId: input.aiQueryId,
    })
    if (!result.success) return result

    const { message, usage, durationMs } = result.data
    total.inputTokens     += usage.inputTokens
    total.outputTokens    += usage.outputTokens
    total.cacheReadTokens += usage.cacheReadTokens
    total.costUsd          = total.costUsd.add(usage.costUsd)
    total.durationMs      += durationMs

    // The whole turn goes back, thinking blocks included: the API needs them to continue it.
    messages.push({ role: 'assistant', content: message.content })

    if (message.stop_reason === 'pause_turn') continue
    if (message.stop_reason !== 'tool_use') {
      return {
        success: true,
        data: { text: textOf(message), rounds, ...total, costUsd: toDecimalString(total.costUsd) },
      }
    }

    // Several tool calls in one turn are answered together, in one user message.
    const calls = message.content.filter(block => block.type === 'tool_use')
    const results = await Promise.all(calls.map(async (block): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
      const outcome = await input.runTool({ name: block.name, input: block.input }).catch((error: unknown) => {
        console.error(`[AI] tool ${block.name} failed`, error)
        return { content: 'The lookup failed on the server. Tell the user it could not be looked up right now.', isError: true }
      })
      return { type: 'tool_result', tool_use_id: block.id, content: outcome.content, is_error: outcome.isError }
    }))
    messages.push({ role: 'user', content: results })
  }

  return {
    success: false,
    status: 422,
    error: 'This question needed too many lookups. Try asking something narrower.',
    retryable: false,
    callId: null,
  }
}

/** A stored AI insight as pages show it (Week 9 Task 2, E3) — shared by every insight feature. */
export type AiInsightDto = {
  status: AiInsightStatus
  content: string | null
  /**
   * FAILED: why. READY: the last Regenerate could not be written, and the text
   * shown is the earlier one (Week 10 Task 2). Otherwise null.
   */
  error: string | null
  /** PENDING with the earlier text still there: a Regenerate is being written. */
  regenerating: boolean
  model: string | null
  /** ISO; set once READY. */
  generatedAt: string | null
  /** What the call behind it cost (estimated USD); null before one was made. */
  costUsd: string | null
}

export function toInsightDto(insight: AiInsightSummary): AiInsightDto {
  return {
    status:      insight.status,
    content:     insight.content,
    error:       insight.error,
    regenerating: insight.status === 'PENDING' && insight.content !== null,
    model:       insight.model,
    generatedAt: insight.generatedAt?.toISOString() ?? null,
    costUsd:     insight.aiCall ? toDecimalString(insight.aiCall.costUsd) : null,
  }
}

/** Longest message the connection test sends; it only has to prove a round trip. */
export const TEST_MESSAGE_MAX = 500

/**
 * The Test connection button on AI Settings (D10): one short real call, so
 * an admin sees the key, the model, the language rule and the cost work
 * end to end. Recorded like any other call.
 */
async function testConnection(message: string, userId: string): Promise<AiResult<AiCompletion>> {
  return complete({
    feature: AiFeature.CONNECTION_TEST,
    instructions: 'This is a connection test sent by an admin from the AI Settings page. Reply to their message in one or two sentences.',
    messages: [{ role: 'user', content: message }],
    userId,
  })
}

export const AiService = {
  overview,
  complete,
  converse,
  testConnection,
}
