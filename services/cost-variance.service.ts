import { AiFeature, AiInsightStatus, AiInsightType, Prisma, ProductionStatus } from '@prisma/client'
import { trimDecimal } from '@/lib/format'
import { AI_JOB_OPTIONS, COST_VARIANCE_EXPLAIN, getAiQueue, type CostVarianceJob } from '@/lib/queue'
import { toDecimalString } from '@/lib/decimal'
import { InventoryRepository } from '@/repositories/inventory.repository'
import { AiInsightRepository, type AiInsightReference } from '@/repositories/ai-insight.repository'
import { AiService, toInsightDto, type AiInsightDto } from '@/services/ai.service'
import {
  ProductionOrderRepository,
  type ProductionOrderForCostComparison,
} from '@/repositories/production-order.repository'

/**
 * FEATURE 1 — Cost Variance Explainer (Week 9 Task 2,
 * docs/2026-11-19-week9-cost-variance-explainer.md). Code works out exactly
 * why a batch cost more or less than the last one (E2); Claude only puts
 * those figures into words. Every amount is per unit of output (per kg).
 */

/** What a run is compared with: the previous run of the same good, or — for its first run — its own plan (E1). */
export type CostBasis = 'PREVIOUS_BATCH' | 'PLAN'

export type BatchFactsDto = {
  productionOrderId: string
  orderNumber: string
  branchName: string
  /** YYYY-MM-DD, the lot's production date. */
  producedOn: string
  bomVersion: number
  batchCount: number
  batchWeight: string
  plannedQty: string
  actualQty: string
  /** actualQty ÷ plannedQty × 100, one decimal place. */
  yieldPercent: string
  actualCost: string
  costPerUnit: string
  /** plannedCost ÷ plannedQty: the cost per unit the plan expected. */
  plannedCostPerUnit: string
}

/** One ingredient's part in the change, per unit of output. */
export type IngredientChangeDto = {
  materialId: string
  materialName: string
  unitAbbreviation: string
  /** BOTH, or only in this run's recipe (ADDED) / only in the last one's (REMOVED). */
  presence: 'BOTH' | 'ADDED' | 'REMOVED'
  /** Ingredient used per unit of output, in the ingredient's unit. */
  usagePerUnit: string | null
  previousUsagePerUnit: string | null
  unitPrice: string | null
  previousUnitPrice: string | null
  costPerUnit: string | null
  previousCostPerUnit: string | null
  /** costPerUnit − previousCostPerUnit = priceEffect + usageEffect. */
  change: string
  /** (price − previous price) × usage now. */
  priceEffect: string
  /** (usage now − previous usage) × previous price: yield and recipe together. */
  usageEffect: string
}

export type CostComparisonDto = {
  finishedGoodName: string
  unitAbbreviation: string
  basis: CostBasis
  current: BatchFactsDto
  /** Null when the basis is the plan. */
  previous: BatchFactsDto | null
  /** The cost per unit compared with: the previous run's, or the planned one. */
  basisCostPerUnit: string
  /** current − basis, per unit. */
  change: string
  /** change ÷ basis × 100, one decimal place. */
  percentChange: string
  /** Of the change: what came from ingredient prices … */
  priceEffect: string
  /** … and what came from how much was used per unit — yield and recipe. */
  usageEffect: string
  recipeChanged: boolean
  /** Biggest change first, by size; empty when the basis is the plan (no per-line plan is stored). */
  ingredients: IngredientChangeDto[]
}

type Ingredient = {
  materialName: string
  unitAbbreviation: string
  quantity: Prisma.Decimal
  unitPrice: Prisma.Decimal
}

const ZERO = new Prisma.Decimal(0)

/** A completed, costed run: what the comparison needs, or null if it has no recorded cost. */
type CostedRun = ProductionOrderForCostComparison & {
  actualQty: Prisma.Decimal
  plannedCost: Prisma.Decimal
  actualCost: Prisma.Decimal
  costPerUnit: Prisma.Decimal
  completedAt: Date
  lot: { producedOn: Date }
}

function asCostedRun(order: ProductionOrderForCostComparison | null): CostedRun | null {
  if (!order || order.status !== ProductionStatus.COMPLETED) return null
  const { actualQty, plannedCost, actualCost, costPerUnit, completedAt, lot } = order
  if (actualQty === null || plannedCost === null || actualCost === null || costPerUnit === null || completedAt === null || lot === null) return null
  return { ...order, actualQty, plannedCost, actualCost, costPerUnit, completedAt, lot }
}

function percent(part: Prisma.Decimal, whole: Prisma.Decimal): string {
  return toDecimalString(part.div(whole).mul(100).toDecimalPlaces(1))
}

function batchFacts(run: CostedRun): BatchFactsDto {
  return {
    productionOrderId:  run.id,
    orderNumber:        run.orderNumber,
    branchName:         run.branch.name,
    producedOn:         run.lot.producedOn.toISOString().slice(0, 10),
    bomVersion:         run.bom.version,
    batchCount:         run.batchCount,
    batchWeight:        toDecimalString(run.batchWeight),
    plannedQty:         toDecimalString(run.plannedQty),
    actualQty:          toDecimalString(run.actualQty),
    yieldPercent:       percent(run.actualQty, run.plannedQty),
    actualCost:         toDecimalString(run.actualCost),
    costPerUnit:        toDecimalString(run.costPerUnit),
    plannedCostPerUnit: toDecimalString(run.plannedCost.div(run.plannedQty)),
  }
}

/**
 * What a run took out of stock, per material, at the price it was costed at
 * — read from the ledger, as the Costing card does, so it is exactly what
 * approval recorded and never re-priced.
 */
async function ingredientsOf(productionOrderId: string): Promise<Map<string, Ingredient>> {
  const movements = await InventoryRepository.findMovementsByReference('ProductionOrder', productionOrderId)
  const byMaterial = new Map<string, Ingredient>()
  for (const movement of movements) {
    // Every costed run's movements carry a price (Week 6 Task 3).
    if (movement.unitCost === null) continue
    const existing = byMaterial.get(movement.materialId)
    byMaterial.set(movement.materialId, {
      materialName:     movement.material.name,
      unitAbbreviation: movement.material.unit.abbreviation,
      quantity:         (existing?.quantity ?? ZERO).add(movement.quantity.abs()),
      unitPrice:        movement.unitCost,
    })
  }
  return byMaterial
}

/**
 * Each ingredient's change in cost per unit of output, split exactly into a
 * price effect and a usage effect (E2):
 *   new − old = (p₁ − p₀) × q₁  +  (q₁ − q₀) × p₀
 * where q is the ingredient used per unit of output. An ingredient only in
 * one recipe is all usage effect.
 */
function ingredientChanges(
  current: Map<string, Ingredient>, currentQty: Prisma.Decimal,
  previous: Map<string, Ingredient>, previousQty: Prisma.Decimal,
): IngredientChangeDto[] {
  const materialIds = new Set([...current.keys(), ...previous.keys()])
  const rows = [...materialIds].map<IngredientChangeDto>(materialId => {
    const now  = current.get(materialId)
    const then = previous.get(materialId)
    const q1 = now ? now.quantity.div(currentQty) : ZERO
    const q0 = then ? then.quantity.div(previousQty) : ZERO
    const p1 = now?.unitPrice ?? ZERO
    const p0 = then?.unitPrice ?? ZERO
    const priceEffect = now && then ? p1.sub(p0).mul(q1) : ZERO
    const usageEffect = then ? q1.sub(q0).mul(p0) : q1.mul(p1)
    const change      = priceEffect.add(usageEffect)
    const named       = now ?? then
    return {
      materialId,
      materialName:         named?.materialName ?? materialId,
      unitAbbreviation:     named?.unitAbbreviation ?? '',
      presence:             now && then ? 'BOTH' : now ? 'ADDED' : 'REMOVED',
      usagePerUnit:         now ? toDecimalString(q1) : null,
      previousUsagePerUnit: then ? toDecimalString(q0) : null,
      unitPrice:            now ? toDecimalString(p1) : null,
      previousUnitPrice:    then ? toDecimalString(p0) : null,
      costPerUnit:          now ? toDecimalString(q1.mul(p1)) : null,
      previousCostPerUnit:  then ? toDecimalString(q0.mul(p0)) : null,
      change:               toDecimalString(change),
      priceEffect:          toDecimalString(priceEffect),
      usageEffect:          toDecimalString(usageEffect),
    }
  })
  const size = (row: IngredientChangeDto) => new Prisma.Decimal(row.change).abs()
  return rows.sort((a, b) => size(b).comparedTo(size(a)) || a.materialName.localeCompare(b.materialName))
}

/**
 * Why a completed run cost what it did per unit, compared with the previous
 * run of the same good — or, for the good's first run, with its own plan.
 * Null for a run that is not completed or has no recorded cost.
 */
async function comparison(productionOrderId: string): Promise<CostComparisonDto | null> {
  const current = asCostedRun(await ProductionOrderRepository.findForCostComparison(productionOrderId))
  if (!current) return null

  const previous = asCostedRun(await ProductionOrderRepository.findPreviousCompleted(current.finishedGoodId, {
    id: current.id, producedOn: current.lot.producedOn, completedAt: current.completedAt,
  }))

  const common = {
    finishedGoodName: current.finishedGood.name,
    unitAbbreviation: current.finishedGood.unit.abbreviation,
    current:          batchFacts(current),
  }

  if (!previous) {
    // Against the plan. A completion deducts the planned quantities, so the
    // only differences are the prices (plan date vs production date) and the
    // yield (planned vs actual output):
    //   actual/kg − planned/kg = (actualCost − plannedCost) ÷ plannedQty
    //                          + (actualCost ÷ actualQty − actualCost ÷ plannedQty)
    const planned = current.plannedCost.div(current.plannedQty)
    const change  = current.costPerUnit.sub(planned)
    return {
      ...common,
      basis:            'PLAN',
      previous:         null,
      basisCostPerUnit: toDecimalString(planned),
      change:           toDecimalString(change),
      percentChange:    percent(change, planned),
      priceEffect:      toDecimalString(current.actualCost.sub(current.plannedCost).div(current.plannedQty)),
      usageEffect:      toDecimalString(current.costPerUnit.sub(current.actualCost.div(current.plannedQty))),
      recipeChanged:    false,
      ingredients:      [],
    }
  }

  const [currentIngredients, previousIngredients] = await Promise.all([
    ingredientsOf(current.id),
    ingredientsOf(previous.id),
  ])
  const ingredients = ingredientChanges(currentIngredients, current.actualQty, previousIngredients, previous.actualQty)
  const change = current.costPerUnit.sub(previous.costPerUnit)
  const sum = (pick: (row: IngredientChangeDto) => string) =>
    ingredients.reduce((total, row) => total.add(pick(row)), ZERO)

  return {
    ...common,
    basis:            'PREVIOUS_BATCH',
    previous:         batchFacts(previous),
    basisCostPerUnit: toDecimalString(previous.costPerUnit),
    change:           toDecimalString(change),
    percentChange:    percent(change, previous.costPerUnit),
    priceEffect:      toDecimalString(sum(row => row.priceEffect)),
    usageEffect:      toDecimalString(sum(row => row.usageEffect)),
    recipeChanged:    current.bom.version !== previous.bom.version,
    ingredients,
  }
}

/** Ingredients sent to Claude: the ones that moved the cost most. The card lists them all. */
const FACT_INGREDIENTS = 6

/**
 * Claude's brief (E7). The figures arrive already worked out; the prompt's
 * job is to keep it to them and to say them plainly.
 */
const EXPLAIN_INSTRUCTIONS = `You explain why one production batch cost what it did, for the kitchen and accounting team. The figures you get were calculated exactly by the system; quote them as given and do not recalculate, re-round or add figures of your own.

Write 3 to 5 sentences, under 110 words in all, in plain text with no headings, lists or Markdown. Name at most two ingredients.
- Start with the change in cost per kg and what it is compared with: the previous batch of the same product, or, for a product's first batch, its plan.
- Then give the main cause in pesos per kg. A price effect means an ingredient's price changed. A usage effect means more or less of an ingredient went into each kg made — that comes from the yield (how much was made against the plan) or from a recipe change.
- If the yield moved, say so with both percentages.
- End with one practical point only if the figures support it, such as a price that went up or a yield that dropped. Do not suggest causes the figures do not show, such as spoilage, theft or staff.`

/** Pesos to the centavo, as the card shows them. */
function peso(value: string): string {
  return new Prisma.Decimal(value).toDecimalPlaces(2).toFixed(2)
}

/**
 * What Claude is given (E2, E3): the comparison, rounded the way the card
 * shows it, so the explanation quotes the same figures the reader sees above
 * it. Stored on the insight as `facts`.
 */
function explanationFacts(comparison: CostComparisonDto) {
  const batch = (facts: BatchFactsDto) => ({
    orderNumber:  facts.orderNumber,
    producedOn:   facts.producedOn,
    branch:       facts.branchName,
    recipeVersion: facts.bomVersion,
    batches:      `${facts.batchCount} × ${trimDecimal(facts.batchWeight)} ${comparison.unitAbbreviation}`,
    plannedQty:   trimDecimal(facts.plannedQty),
    actualQty:    trimDecimal(facts.actualQty),
    yieldPercent: Number(facts.yieldPercent).toFixed(1),
    batchCost:    peso(facts.actualCost),
    costPerUnit:  peso(facts.costPerUnit),
  })
  const moved = comparison.ingredients.filter(row => !new Prisma.Decimal(row.change).isZero())
  return {
    product:      comparison.finishedGoodName,
    unit:         comparison.unitAbbreviation,
    currency:     'PHP',
    comparedWith: comparison.basis === 'PLAN' ? 'its plan (first batch of this product on record)' : 'the previous batch of this product',
    thisBatch:    batch(comparison.current),
    previousBatch: comparison.previous ? batch(comparison.previous) : null,
    plannedCostPerUnit: comparison.basis === 'PLAN' ? peso(comparison.basisCostPerUnit) : undefined,
    costPerUnitChange:  peso(comparison.change),
    percentChange:      Number(comparison.percentChange).toFixed(1),
    fromIngredientPrices: peso(comparison.priceEffect),
    fromUsageAndYield:    peso(comparison.usageEffect),
    recipeChanged:        comparison.recipeChanged,
    biggestIngredientChanges: moved.slice(0, FACT_INGREDIENTS).map(row => ({
      ingredient:          row.materialName,
      presence:            row.presence,
      pricePerUnitNow:     row.unitPrice === null ? null : `${peso(row.unitPrice)}/${row.unitAbbreviation}`,
      pricePerUnitBefore:  row.previousUnitPrice === null ? null : `${peso(row.previousUnitPrice)}/${row.unitAbbreviation}`,
      costPerKgNow:        row.costPerUnit === null ? null : peso(row.costPerUnit),
      costPerKgBefore:     row.previousCostPerUnit === null ? null : peso(row.previousCostPerUnit),
      change:              peso(row.change),
      fromPrice:           peso(row.priceEffect),
      fromUsage:           peso(row.usageEffect),
    })),
    otherIngredientsWithSmallerChanges: Math.max(0, moved.length - FACT_INGREDIENTS),
  }
}

/** Where a production order's explanation is stored. */
function insightReference(productionOrderId: string): AiInsightReference {
  return { type: AiInsightType.COST_VARIANCE, referenceType: 'ProductionOrder', referenceId: productionOrderId }
}

/** The order's stored explanation, in whatever state it is; null if none was ever asked for. */
async function insight(productionOrderId: string): Promise<AiInsightDto | null> {
  const row = await AiInsightRepository.find(insightReference(productionOrderId))
  return row ? toInsightDto(row) : null
}

export type CostVarianceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status: number }

/**
 * Asks for a completed order's explanation (E4, E6): the insight goes PENDING
 * and the job is queued. `queued: false` when one is already pending or
 * written — nothing is queued, so two clicks cannot pay for two calls.
 * A queue failure never fails what the caller was doing (approving a
 * completion): the insight is marked FAILED with a reason, so the card
 * offers Try again instead of spinning forever.
 */
async function request(
  productionOrderId: string,
  requestedById: string | null,
  options: { regenerate?: boolean } = {},
): Promise<CostVarianceResult<{ queued: boolean }>> {
  const found = await ProductionOrderRepository.findForCostComparison(productionOrderId)
  if (!found) {
    return { success: false, error: 'Production order not found', status: 404 }
  }
  if (!asCostedRun(found)) {
    return { success: false, error: 'Only a completed production order with a recorded cost can be explained', status: 409 }
  }

  const ref = insightReference(productionOrderId)
  // Regenerate (Week 10 Task 2) rewrites a READY one; otherwise a missing or FAILED one is asked for.
  const asked = options.regenerate ? await AiInsightRepository.regenerate(ref) : await AiInsightRepository.request(ref)
  if (!asked) return { success: true, data: { queued: false } }

  try {
    await getAiQueue().add(COST_VARIANCE_EXPLAIN, { productionOrderId, requestedById } satisfies CostVarianceJob, AI_JOB_OPTIONS)
  } catch (err) {
    console.error('[CostVarianceService] could not queue the explanation', err)
    await AiInsightRepository.fail(ref, { error: 'Could not queue the explanation (the job queue is unavailable). Try again.' })
  }
  return { success: true, data: { queued: true } }
}

/** The worker's last word when a job dies of an unexpected error: a PENDING insight must not spin forever. */
async function giveUp(productionOrderId: string, error: string): Promise<void> {
  await AiInsightRepository.fail(insightReference(productionOrderId), { error })
}

/** How a run of explain() ended — the job decides from this whether to try again. */
export type ExplainOutcome = 'READY' | 'FAILED' | 'RETRY' | 'SKIPPED'

/**
 * Writes the explanation of a PENDING insight (E2, E7): the comparison as
 * facts → AiService.complete() → READY with the text, or FAILED with the
 * reason. A failure worth retrying (busy, unreachable) leaves it PENDING and
 * returns RETRY, unless this is the last attempt. Anything not PENDING is
 * left alone (SKIPPED): nobody asked, or it is already written.
 */
async function explain(
  productionOrderId: string,
  options: { userId: string | null; lastAttempt: boolean },
): Promise<ExplainOutcome> {
  const ref = insightReference(productionOrderId)
  const current = await AiInsightRepository.find(ref)
  if (current?.status !== AiInsightStatus.PENDING) return 'SKIPPED'

  const costs = await comparison(productionOrderId)
  if (!costs) {
    await AiInsightRepository.fail(ref, { error: 'This order has no recorded cost to explain.' })
    return 'FAILED'
  }

  const facts  = explanationFacts(costs)
  const prompt = `Explain why production order ${costs.current.orderNumber} (${costs.finishedGoodName}) cost what it did per ${costs.unitAbbreviation}.\n\n<figures>\n${JSON.stringify(facts, null, 2)}\n</figures>`
  const result = await AiService.complete({
    feature:      AiFeature.COST_VARIANCE,
    instructions: EXPLAIN_INSTRUCTIONS,
    messages:     [{ role: 'user', content: prompt }],
    userId:       options.userId,
  })

  if (result.success) {
    const content = result.data.text.trim()
    if (content !== '') {
      await AiInsightRepository.complete(ref, { content, facts, prompt, model: result.data.servedModel, aiCallId: result.data.callId })
      return 'READY'
    }
    await AiInsightRepository.fail(ref, { error: 'The AI returned an empty answer.', facts, prompt, aiCallId: result.data.callId })
    return 'FAILED'
  }

  if (result.retryable && !options.lastAttempt) return 'RETRY'
  await AiInsightRepository.fail(ref, { error: result.error, facts, prompt, aiCallId: result.callId })
  return 'FAILED'
}

export const CostVarianceService = {
  comparison,
  insight,
  request,
  explain,
  giveUp,
}
