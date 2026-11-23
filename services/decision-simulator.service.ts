import { AiFeature, BomKind, Prisma } from '@prisma/client'
import { addDays, todayIsoDate } from '@/lib/dates'
import { trimDecimal } from '@/lib/format'
import { BomRepository } from '@/repositories/bom.repository'
import { BranchRepository } from '@/repositories/branch.repository'
import { DemandForecastRepository } from '@/repositories/demand-forecast.repository'
import { InventoryRepository } from '@/repositories/inventory.repository'
import { ItemPriceRepository } from '@/repositories/item-price.repository'
import { MaterialRepository } from '@/repositories/material.repository'
import { AiService } from '@/services/ai.service'
import { stockStatus, type StockStatus } from '@/services/inventory.service'
import { committedAtBranch, consumptionByMaterial } from '@/services/production-order.service'

/**
 * FEATURE 7 — Decision Simulator (Week 10 Task 6,
 * docs/2026-11-23-week10-decision-simulator.md). "Run 5 batches of Dinuguan
 * and 3 of Bopis tomorrow at Las Piñas": the code runs it against the live
 * recipes, stock and prices — what each ingredient needs, what is free, what
 * is short and by how much, what the run costs and per kg, and where stock
 * ends up against its reorder point. Nothing is written. Claude, on request,
 * explains the outcome and recommends one adjustment from the figures (P1);
 * the answer is not stored — the AiCall is the record (P5).
 *
 * Measured exactly as a real order is: the recipe scaled by
 * consumptionByMaterial (what sign-off deducts), free stock = on hand − what
 * approved runs still need (committedAtBranch, the order page's stock check),
 * priced at the reference price in force on the day (as costRun does).
 */

export const SIMULATOR_MAX_LINES = 8
export const SIMULATOR_MAX_BATCHES = 50
/** How far ahead a run can be simulated. */
export const SIMULATOR_AHEAD_DAYS = 14
/** Ask for the explanation: the planners and accounting (the Costing screen links here). */
export const SIMULATOR_EXPLAIN_ROLES = ['ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTING']
/** Turn a line into a real production order. */
export const SIMULATOR_ORDER_ROLES = ['ADMIN', 'PRODUCTION_MANAGER']
const YIELD_DAYS = 30
const MAX_BATCHES_SHOWN = 99

const ZERO = new Prisma.Decimal(0)

export type SimulationInput = {
  kitchenId: string
  /** YYYY-MM-DD: the day the run is for — prices are those in force then. */
  date: string
  lines: { finishedGoodId: string; batches: number }[]
}

export type SimulatedLineDto = {
  finishedGoodId: string
  name: string
  unit: string
  bomVersion: number
  batches: number
  batchSize: string
  plannedQty: string
  /** Ingredients at the day's reference prices; null when one has no price. */
  cost: string | null
  /** cost ÷ planned output. */
  costPerUnit: string | null
  /** The kitchen's yield on this good over the last 30 days, 1 decimal; null with no runs (100 % then). */
  yieldPercent: string | null
  expectedOutput: string
  /** cost ÷ expected output — what a kg that actually comes out costs. */
  costPerExpectedUnit: string | null
  /** The most batches of this good the free stock allows, the other lines as they are (0 when it cannot run at all). */
  maxBatches: number
}

export type SimulatedIngredientDto = {
  materialId: string
  name: string
  code: string
  unit: string
  need: string
  onHand: string
  /** Approved runs at the kitchen still to take it. */
  committed: string
  /** onHand − committed; can be below 0 when runs already need more than is there. */
  free: string
  /** max(0, need − max(free, 0)). */
  short: string
  /** free − need: where stock would stand after this run and the approved ones. */
  after: string
  reorderPoint: string
  afterStatus: StockStatus
  unitPrice: string | null
  cost: string | null
  usedBy: string[]
}

export type SimulationDto = {
  kitchen: { id: string; name: string }
  date: string
  lines: SimulatedLineDto[]
  /** Shortest first, then the ones that end below their reorder point, then by name. */
  ingredients: SimulatedIngredientDto[]
  totals: {
    cost: string | null
    plannedQty: string
    costPerUnit: string | null
    shortIngredients: number
    lowAfter: number
    missingPrices: string[]
  }
  /** Nothing short: the run can go ahead with the stock on hand. */
  feasible: boolean
}

export type SimulatorResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status: number }

function qty(value: Prisma.Decimal): string {
  return trimDecimal(value.toDecimalPlaces(3).toFixed(3))
}
function peso(value: Prisma.Decimal): string {
  return value.toDecimalPlaces(2).toFixed(2)
}

/** Runs the scenario. Read-only: nothing is written anywhere. */
async function simulate(input: SimulationInput): Promise<SimulatorResult<SimulationDto>> {
  const today = todayIsoDate()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || input.date < today || input.date > addDays(today, SIMULATOR_AHEAD_DAYS)) {
    return { success: false, error: `Pick a day from today to ${SIMULATOR_AHEAD_DAYS} days ahead`, status: 400 }
  }
  if (input.lines.length === 0 || input.lines.length > SIMULATOR_MAX_LINES) {
    return { success: false, error: `Simulate 1 to ${SIMULATOR_MAX_LINES} goods at a time`, status: 400 }
  }
  if (new Set(input.lines.map(line => line.finishedGoodId)).size !== input.lines.length) {
    return { success: false, error: 'Each good once — put all its batches on one line', status: 400 }
  }
  if (input.lines.some(line => !Number.isInteger(line.batches) || line.batches < 1 || line.batches > SIMULATOR_MAX_BATCHES)) {
    return { success: false, error: `Batches are whole numbers from 1 to ${SIMULATOR_MAX_BATCHES}`, status: 400 }
  }
  const kitchen = (await BranchRepository.findActiveKitchens()).find(row => row.id === input.kitchenId)
  if (!kitchen) return { success: false, error: 'Pick an active kitchen — outlets do not cook', status: 400 }

  // Only what a production order could be planned from: an active good with an active PRODUCTION recipe.
  const plannable = new Set((await BomRepository.findAllActiveForPlanning()).map(bom => bom.finishedGood.id))
  if (input.lines.some(line => !plannable.has(line.finishedGoodId))) {
    return { success: false, error: 'A good on the list has no active recipe', status: 400 }
  }
  const boms = await Promise.all(input.lines.map(line => BomRepository.findActiveByFinishedGood(line.finishedGoodId, BomKind.PRODUCTION)))
  if (boms.some(bom => bom === null)) return { success: false, error: 'A good on the list has no active recipe', status: 400 }

  // Per line: what the run takes, and what one batch takes (for the most batches the stock allows).
  const runs = input.lines.map((line, index) => {
    const bom = boms[index]!
    const plannedQty = bom.batchSize.mul(line.batches)
    return {
      line, bom, plannedQty,
      consumption: consumptionByMaterial(bom, bom.batchSize, plannedQty),
      perBatch:    consumptionByMaterial(bom, bom.batchSize, bom.batchSize),
    }
  })
  const need = new Map<string, Prisma.Decimal>()
  for (const run of runs) {
    for (const [materialId, { quantity }] of run.consumption) need.set(materialId, (need.get(materialId) ?? ZERO).add(quantity))
  }
  const materialIds = [...need.keys()]

  const [onHand, committed, prices, materials, yields] = await Promise.all([
    InventoryRepository.levelsAtBranch(kitchen.id, materialIds),
    committedAtBranch(kitchen.id),
    // Date-only prices are stored at UTC midnight; the end of that day takes in every price effective on it.
    ItemPriceRepository.findPricesAsOf(materialIds, new Date(`${input.date}T23:59:59.999Z`), null),
    MaterialRepository.findManyByIds(materialIds),
    DemandForecastRepository.yields(kitchen.id, addDays(today, -YIELD_DAYS)),
  ])
  const free = (materialId: string) => (onHand.get(materialId) ?? ZERO).sub(committed.get(materialId) ?? ZERO)
  const yieldOf = new Map(yields.map(row => [row.finishedGoodId, row]))

  const lines = runs.map<SimulatedLineDto>(run => {
    let cost: Prisma.Decimal | null = ZERO
    for (const [materialId, { quantity }] of run.consumption) {
      const price = prices.get(materialId)
      cost = cost !== null && price ? cost.add(quantity.mul(price.unitPrice)) : null
    }
    const history = yieldOf.get(run.bom.finishedGood.id)
    const measured = history && history.planned.gt(0) ? history.actual.div(history.planned) : null
    const expectedOutput = measured ? run.plannedQty.mul(measured) : run.plannedQty

    // The most batches the free stock allows for this good, the other lines as they are.
    let maxBatches = MAX_BATCHES_SHOWN
    for (const [materialId, { quantity: perBatch }] of run.perBatch) {
      if (perBatch.lte(0)) continue
      const others = (need.get(materialId) ?? ZERO).sub(run.consumption.get(materialId)?.quantity ?? ZERO)
      const room = Prisma.Decimal.max(free(materialId), ZERO).sub(others)
      maxBatches = Math.min(maxBatches, Math.max(0, room.div(perBatch).floor().toNumber()))
    }

    return {
      finishedGoodId:      run.bom.finishedGood.id,
      name:                run.bom.finishedGood.name,
      unit:                run.bom.batchUnit.abbreviation,
      bomVersion:          run.bom.version,
      batches:             run.line.batches,
      batchSize:           qty(run.bom.batchSize),
      plannedQty:          qty(run.plannedQty),
      cost:                cost === null ? null : peso(cost),
      costPerUnit:         cost === null ? null : peso(cost.div(run.plannedQty)),
      yieldPercent:        measured ? measured.mul(100).toDecimalPlaces(1).toFixed(1) : null,
      expectedOutput:      qty(expectedOutput),
      costPerExpectedUnit: cost === null || expectedOutput.isZero() ? null : peso(cost.div(expectedOutput)),
      maxBatches,
    }
  })

  const statusRank: Record<StockStatus, number> = { OUT: 0, LOW: 1, HEALTHY: 2, UNTRACKED: 3 }
  const ingredients = materialIds.map<SimulatedIngredientDto>(materialId => {
    const material = materials.get(materialId)
    const needed = need.get(materialId) ?? ZERO
    const freeNow = free(materialId)
    const after = freeNow.sub(needed)
    const reorderPoint = material?.reorderPoint ?? ZERO
    const price = prices.get(materialId)
    return {
      materialId,
      name:         material?.name ?? materialId,
      code:         material?.code ?? '',
      unit:         material?.unit.abbreviation ?? '',
      need:         qty(needed),
      onHand:       qty(onHand.get(materialId) ?? ZERO),
      committed:    qty(committed.get(materialId) ?? ZERO),
      free:         qty(freeNow),
      short:        qty(Prisma.Decimal.max(needed.sub(Prisma.Decimal.max(freeNow, ZERO)), ZERO)),
      after:        qty(after),
      reorderPoint: qty(reorderPoint),
      afterStatus:  stockStatus(after, reorderPoint),
      unitPrice:    price ? peso(price.unitPrice) : null,
      cost:         price ? peso(needed.mul(price.unitPrice)) : null,
      usedBy:       runs.filter(run => run.consumption.has(materialId)).map(run => run.bom.finishedGood.name),
    }
  }).sort((a, b) =>
    Number(b.short !== '0') - Number(a.short !== '0')
    || statusRank[a.afterStatus] - statusRank[b.afterStatus]
    || a.name.localeCompare(b.name))

  const plannedQty = runs.reduce((total, run) => total.add(run.plannedQty), ZERO)
  const missingPrices = ingredients.filter(row => row.unitPrice === null).map(row => row.name)
  const totalCost = missingPrices.length > 0
    ? null
    : ingredients.reduce((total, row) => total.add(row.cost ?? '0'), ZERO)
  const shortIngredients = ingredients.filter(row => row.short !== '0').length

  return {
    success: true,
    data: {
      kitchen,
      date: input.date,
      lines,
      ingredients,
      totals: {
        cost:        totalCost === null ? null : peso(totalCost),
        plannedQty:  qty(plannedQty),
        costPerUnit: totalCost === null || plannedQty.isZero() ? null : peso(totalCost.div(plannedQty)),
        shortIngredients,
        lowAfter:    ingredients.filter(row => row.short === '0' && (row.afterStatus === 'LOW' || row.afterStatus === 'OUT')).length,
        missingPrices,
      },
      feasible: shortIngredients === 0,
    },
  }
}

/** What Claude is given: the simulation as the page shows it. */
function explanationFacts(simulation: SimulationDto) {
  return {
    kitchen:  simulation.kitchen.name,
    day:      simulation.date,
    currency: 'PHP',
    feasible: simulation.feasible,
    runs: simulation.lines.map(line => ({
      good:              line.name,
      batches:           `${line.batches} × ${line.batchSize} ${line.unit} = ${line.plannedQty} ${line.unit}`,
      cost:              line.cost,
      costPerUnitPlanned: line.costPerUnit,
      yield:             line.yieldPercent ? `${line.yieldPercent}% (last 30 days)` : 'no runs yet — 100% assumed',
      expectedOutput:    `${line.expectedOutput} ${line.unit}`,
      costPerUnitExpected: line.costPerExpectedUnit,
      mostBatchesTheStockAllows: line.maxBatches,
    })),
    totals: simulation.totals,
    ingredients: simulation.ingredients
      .filter(row => row.short !== '0' || row.afterStatus === 'LOW' || row.afterStatus === 'OUT')
      .map(row => ({
        ingredient:    row.name,
        unit:          row.unit,
        need:          row.need,
        free:          `${row.free} (on hand ${row.onHand} − ${row.committed} for approved runs)`,
        short:         row.short,
        stockAfter:    row.after,
        reorderPoint:  row.reorderPoint,
        afterStatus:   row.afterStatus,
        usedBy:        row.usedBy,
      })),
    otherIngredientsAllFine: simulation.ingredients.filter(row => row.short === '0' && row.afterStatus !== 'LOW' && row.afterStatus !== 'OUT').length,
  }
}

const INSTRUCTIONS = `You look at a what-if production run for the kitchen of Lydia's Lechon: a plan that has not been made, simulated by the system against the live recipes, stock and prices. Every figure was worked out by the system: quote them as given; do not recalculate, re-round or add figures of your own.

Write at most 5 sentences and under 110 words, in plain text with no headings, lists or Markdown.
- Start with the outcome: whether it can run with the stock on hand, and if not, which ingredients are short and by how much.
- Give the total cost and the cost per kg, and the cost per kg that actually comes out where the yield makes a real difference.
- Name ingredients that would end at or below their reorder point.
- End with one recommendation taken from the figures: for example cut a good to the most batches the stock allows, order the short amount before the run, or go ahead as planned. Say which figure it rests on.
Do not suggest causes or options the figures do not show.`

/** Claude's explanation of a simulation, with one adjustment. Not stored; logged as an AiCall. */
async function explain(simulation: SimulationDto, userId: string): Promise<SimulatorResult<{ text: string; model: string; costUsd: string }>> {
  const prompt = `Look at this simulated production run at ${simulation.kitchen.name} for ${simulation.date}.\n\n<simulation>\n${JSON.stringify(explanationFacts(simulation), null, 2)}\n</simulation>`
  const result = await AiService.complete({
    feature:      AiFeature.DECISION_SIMULATOR,
    instructions: INSTRUCTIONS,
    messages:     [{ role: 'user', content: prompt }],
    userId,
  })
  if (!result.success) return { success: false, error: result.error, status: 502 }
  const text = result.data.text.trim()
  if (text === '') return { success: false, error: 'The AI returned an empty answer. Try again.', status: 502 }
  return { success: true, data: { text, model: result.data.servedModel, costUsd: result.data.costUsd } }
}

export type SimulatorGoodDto = { id: string; name: string; unit: string; batchSize: string }

/** The goods a run can be simulated for: those a production order could be planned from. */
async function goods(): Promise<SimulatorGoodDto[]> {
  return (await BomRepository.findAllActiveForPlanning()).map(bom => ({
    id: bom.finishedGood.id, name: bom.finishedGood.name, unit: bom.batchUnit.abbreviation, batchSize: qty(bom.batchSize),
  }))
}

export const DecisionSimulatorService = {
  goods,
  simulate,
  explain,
}
