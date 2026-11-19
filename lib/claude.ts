import Anthropic from '@anthropic-ai/sdk'
import type { AiFeature } from '@prisma/client'
import { config } from '@/lib/config'

/**
 * The Claude API client and what each AI feature asks of it (Week 9 Task 1,
 * docs/2026-11-18-week9-claude-api-integration.md).
 *
 * NODE RUNTIME ONLY: services that run in the Next.js server and in the
 * worker import this (Feature 1 explains a run's cost from a job), never
 * middleware or a Client Component — the key must not reach a bundle.
 * Importing it opens nothing; the client is built on first use, so
 * `next build` and CI need no key.
 */

/** The model every feature uses (D3, the owner's choice). One place to change it; keep MODEL_PRICES in step. */
export const AI_MODEL: Anthropic.Model = 'claude-sonnet-5-5'

export type AiEffort = NonNullable<Anthropic.Beta.BetaOutputConfig['effort']>

export type AiFeatureSettings = {
  label: string
  model: Anthropic.Model
  /**
   * Sonnet 5.5 always thinks, so effort is the cost lever. Its default is
   * `high` and the levels were recalibrated from Sonnet 5, so every feature
   * states its own: `low` for short write-ups, `medium` for multi-step tool use.
   */
  effort: AiEffort
  /** Thinking counts toward this cap; hitting it cuts the answer short (logged as MAX_TOKENS). */
  maxTokens: number
}

/**
 * Per feature, keyed by the AiFeature its calls are logged under. Typed
 * against the enum, so a feature added to the schema without settings here
 * fails the typecheck. Each Week 9–10 feature adds its row.
 */
export const AI_FEATURES: Record<AiFeature, AiFeatureSettings> = {
  CONNECTION_TEST: { label: 'Connection test', model: AI_MODEL, effort: 'low', maxTokens: 4000 },
  // A short paragraph from figures already worked out (Week 9 Task 2, E7).
  COST_VARIANCE:   { label: 'Cost variance explainer', model: AI_MODEL, effort: 'low', maxTokens: 2000 },
}

/** USD per million tokens. Writes are the 5-minute cache rate (1.25 × input). */
export type ModelPrice = { input: string; output: string; cacheRead: string; cacheWrite: string }

/**
 * Used for the estimated cost of every call (D6) and so for the monthly
 * budget. Sonnet 5 is where a declined Sonnet 5.5 request falls back to (D8),
 * and that attempt bills at its own rates. Check
 * https://platform.claude.com/docs/en/about-claude/pricing when changing a model.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-sonnet-5-5': { input: '2', output: '10', cacheRead: '0.10', cacheWrite: '2.50' },
  'claude-sonnet-5':   { input: '2', output: '10', cacheRead: '0.20', cacheWrite: '2.50' },
}

export function isAiConfigured(): boolean {
  return config.anthropicApiKey !== null
}

let client: Anthropic | null = null

/**
 * The shared client, or null when no key is set (D2). Plain fetch underneath,
 * no open sockets, so unlike Prisma or the queue it needs no globalThis cache
 * across hot reloads. The SDK retries 408 / 409 / 429 / 5xx and connection
 * errors twice by itself.
 */
export function getClaude(): Anthropic | null {
  if (!config.anthropicApiKey) return null
  client ??= new Anthropic({ apiKey: config.anthropicApiKey })
  return client
}
