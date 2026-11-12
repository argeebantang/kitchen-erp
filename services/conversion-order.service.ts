import { BomKind, ConversionStatus, Prisma } from '@prisma/client'
import { toDecimal, toDecimalString } from '@/lib/decimal'
import { expiryFlag, isoDateAt, type ExpiryFlag } from '@/lib/dates'
import { trimDecimal } from '@/lib/format'
import {
  CONVERSION_ORDER_DECIDED,
  CONVERSION_ORDER_SUBMITTED,
  getNotificationQueue,
  type ConversionOrderJob,
} from '@/lib/queue'
import { BomRepository, BomWithDetail } from '@/repositories/bom.repository'
import { BranchRepository } from '@/repositories/branch.repository'
import { FinishedGoodStockRepository, planFefoTakes } from '@/repositories/finished-good-stock.repository'
import { ItemPriceRepository } from '@/repositories/item-price.repository'
import { ApprovalRepository } from '@/repositories/approval.repository'
import { WriteOffRepository } from '@/repositories/write-off.repository'
import { InventoryRepository } from '@/repositories/inventory.repository'
import {
  ConversionDecideResult,
  ConversionOrderListFilters,
  ConversionOrderRepository,
  ConversionOrderWithDetail,
} from '@/repositories/conversion-order.repository'
import { MAX_YIELD_FACTOR } from '@/services/production-order.service'
import type { ApprovalDto } from '@/services/purchase-request.service'

/**
 * Conversion orders (Week 7 Task 1): a conversion already done in the kitchen
 * — unsold Lechon made into Lechon Paksiw — recorded with what it used and
 * what it made, and sent straight to accounting (D4). Nothing moves in stock
 * until accounting approves it (D6).
 */

/** A conversion recipe the form can record against: an active CONVERSION BOM. */
export type ConversionRecipeDto = {
  bomId: string
  version: number
  finishedGoodId: string
  finishedGoodCode: string
  finishedGoodName: string
  unitAbbreviation: string
  batchSize: string
  sourceFinishedGoodId: string
  sourceCode: string
  sourceName: string
  sourceUnitAbbreviation: string
  /** Source used per batch of batchSize. */
  sourceQuantity: string
}

export type ConversionFormDto = {
  recipes: ConversionRecipeDto[]
  branches: { id: string; name: string }[]
}

export type CreateConversionOrderServiceInput = {
  bomId: string
  branchId: string
  sourceQty: string
  outputQty: string
  notes?: string | null
}

/** One lot of the source at the branch, and what approving now would take from it (D6). */
export type SourceLotDto = {
  lotNumber: string
  /** ISO; null for a lot made before expiry was tracked — usable, taken last. */
  expiresAt: string | null
  onHand: string
  /** Expired lots are never taken: expired food is a write-off, not an ingredient. */
  expired: boolean
  /** Expired / within 24 h / within 48 h, on the same clock (Week 7 Task 3, X4). */
  expiry: ExpiryFlag | null
  take: string
  /** The lot's recorded cost per unit — what the source is costed at (D7). */
  unitCost: string | null
}

/**
 * What a conversion costs (D7): the source at the recorded cost of the lots
 * it is taken from, plus the added ingredients at the reference price on the
 * conversion date; spread over the output. Worked out on read until approval
 * records it.
 */
export type ConversionCostDto = {
  /** The conversion date (Manila), YYYY-MM-DD: the prices' date. */
  pricedOn: string
  /** Null while the source is short or a lot taken has no recorded cost. */
  sourceCost: string | null
  /** Added ingredients × reference price; null while one has no price. */
  conversionCost: string | null
  /** Material names with no reference price on pricedOn — approval is refused. */
  missing: string[]
  total: string | null
  /** total ÷ output; null until an output is entered. */
  perUnit: string | null
}

/**
 * What a conversion does to the books: the source out of its lots, the added
 * ingredients out of material stock, the output in as a new lot. One shape
 * for the form's live preview and the order page, so they cannot disagree.
 */
export type ConversionEffectDto = {
  branchName: string
  source: {
    finishedGoodName: string
    unitAbbreviation: string
    /** Null while no quantity has been entered (the form, before typing). */
    required: string | null
    /** Unexpired stock at the branch, now. */
    unexpiredOnHand: string
    expiredOnHand: string
    /**
     * Claimed by other conversions, and write-offs of unexpired lots, awaiting
     * approval there — not taken yet, but spoken for (Week 7 Task 2, W5).
     */
    pending: string
    /** unexpiredOnHand − pending. */
    available: string
    /** required ≤ available; null while there is no required quantity. */
    enough: boolean | null
    /** Soonest expiry first. */
    lots: SourceLotDto[]
  }
  /** The conversion BOM scaled by the source used; empty until a quantity is entered. */
  ingredients: {
    materialId: string
    materialCode: string
    materialName: string
    unitAbbreviation: string
    deduct: string
    onHand: string
    after: string
    /** Allowed (D5), as in production, but called out. */
    goesNegative: boolean
    /** Reference price on the conversion date; null when there is none. */
    unitPrice: string | null
  }[]
  negativeCount: number
  /** Null until a source quantity is entered. */
  cost: ConversionCostDto | null
  output: {
    finishedGoodName: string
    unitAbbreviation: string
    /** What the recipe says the source used makes: batchSize × sourceQty ÷ sourceQuantity. */
    expected: string | null
    quantity: string | null
    /** quantity ÷ expected × 100, one decimal place. */
    percentOfExpected: string | null
    /** ISO: the conversion moment + the output's shelf life (D8); null without a shelf life. */
    expiresAt: string | null
    shelfLifeHours: number | null
  }
}

/** The form's preview answer. */
export type ConversionPreviewDto = {
  bomId: string
  bomVersion: number
  effect: ConversionEffectDto
}

export type ConversionOrderSummaryDto = {
  id: string
  orderNumber: string
  status: ConversionStatus
  finishedGoodId: string
  finishedGoodCode: string
  finishedGoodName: string
  unitAbbreviation: string
  sourceFinishedGoodId: string
  sourceCode: string
  sourceName: string
  sourceUnitAbbreviation: string
  bomId: string
  bomVersion: number
  sourceQty: string
  outputQty: string
  expectedOutput: string
  percentOfExpected: string
  branchId: string
  branchName: string
  submittedById: string
  submittedByName: string
  /** ISO: when it was recorded and submitted. */
  createdAt: string
  /** YYYY-MM-DD in Manila: the conversion date (D8). */
  convertedOn: string
}

/**
 * What an approved conversion moved, read back from both ledgers so the card
 * shows the books as they are (like a production order's Stock moved card).
 */
export type ConversionStockDto = {
  /** The source lots it took from (signed, negative). */
  sourceLots: { id: string; lotNumber: string; quantity: string; unitAbbreviation: string; unitCost: string | null }[]
  ingredients: {
    id: string
    materialId: string
    branchId: string
    materialCode: string
    materialName: string
    unitAbbreviation: string
    /** Signed: negative, out of stock. */
    quantity: string
    unitCost: string | null
  }[]
  /** The output lot; null only if missing, which approval makes impossible. */
  lot: {
    lotNumber: string; quantity: string; unitAbbreviation: string; producedOn: string; branchName: string
    unitCost: string | null
    expiresAt: string | null
  } | null
}

/** The costs approval recorded (D7). Pesos, unrounded. */
export type RecordedConversionCostDto = {
  sourceCost: string
  conversionCost: string
  total: string
  costPerUnit: string
}

export type ConversionOrderDetailDto = ConversionOrderSummaryDto & {
  notes: string | null
  /** While it awaits approval: what approving now would do. */
  effect: ConversionEffectDto | null
  /** Accounting's decision with its remarks, newest first. */
  decisions: ApprovalDto[]
  /** Once approved. */
  stockMoved: ConversionStockDto | null
  recordedCost: RecordedConversionCostDto | null
}

/** A row of the approvals inbox (D9): what approving now would do, in brief. */
export type PendingConversionDto = ConversionOrderSummaryDto & {
  /** The unexpired source on hand covers it right now. */
  sourceEnough: boolean
  ingredientCount: number
  negativeCount: number
  /** What approving would record as the output's cost per unit; null while it cannot be worked out. */
  costPerUnit: string | null
  /** Ingredients with no reference price on the conversion date — approval is refused. */
  missingPrices: number
}

export type ConversionOrderResult<T> =
  | { success: true;  data: T }
  | { success: false; error: string; status: number }

type Viewer = { userId: string; role: string }

/** Every status, in workflow order — the list page's filter options. */
export const CONVERSION_STATUSES = Object.values(ConversionStatus)

export function isConversionStatus(value: string): value is ConversionStatus {
  return CONVERSION_STATUSES.some(status => status === value)
}

/**
 * The most output a conversion may record, as a multiple of what its recipe
 * says the source used makes: the same typo guard as a production yield
 * (Week 6 Task 1, D3) — a typed 100 for 10.
 */
export const MAX_OUTPUT_FACTOR = MAX_YIELD_FACTOR

/**
 * The same roles middleware allows on /api/conversion-orders, repeated so the
 * rule holds wherever the service is called from.
 */
function canConvert(role: string) {
  return role === 'ADMIN' || role === 'PRODUCTION_MANAGER'
}

type Consumption = Map<string, { item: BomWithDetail['items'][number]; quantity: Prisma.Decimal }>

/** What the recipe says `sourceQty` of the source makes. */
function expectedOutput(bom: { batchSize: Prisma.Decimal; sourceQuantity: Prisma.Decimal | null }, sourceQty: Prisma.Decimal): Prisma.Decimal | null {
  return bom.sourceQuantity === null ? null : bom.batchSize.mul(sourceQty).div(bom.sourceQuantity)
}

/**
 * The added ingredients a conversion uses: the conversion BOM scaled by the
 * source used ÷ the recipe's source per batch (D4), one entry per material
 * (merged if a BOM lists one twice), in BOM order. The approval writes
 * exactly this, and the previews show exactly this.
 *
 * Multiplied before dividing, once per line: 1.5 × 25 ÷ 6 is exactly 6.25,
 * where scaling through a rounded factor (25 ÷ 6 first) leaves
 * 6.2500000000000000001 — and these figures go onto the ledger.
 */
function addedIngredients(bom: BomWithDetail, sourceQty: Prisma.Decimal): Consumption {
  const byMaterial: Consumption = new Map()
  const perBatch = bom.sourceQuantity
  if (perBatch === null) return byMaterial

  for (const item of bom.items) {
    const quantity = item.quantity.mul(sourceQty).div(perBatch)
    const current  = byMaterial.get(item.materialId)
    byMaterial.set(item.materialId, { item, quantity: (current?.quantity ?? new Prisma.Decimal(0)).add(quantity) })
  }
  return byMaterial
}

/** When the output lot must no longer be used (D8). */
function outputExpiry(convertedAt: Date, shelfLifeHours: number | null): Date | null {
  return shelfLifeHours === null ? null : new Date(convertedAt.getTime() + shelfLifeHours * 60 * 60 * 1000)
}

/**
 * The added ingredients at the reference price in force on the conversion
 * date (D7) — one query, the same lookup production costing uses. A price
 * effective at any time that day counts.
 */
async function priceIngredients(consumption: Consumption, pricedOn: string): Promise<{
  prices: Map<string, Prisma.Decimal>
  total: Prisma.Decimal | null
  missing: string[]
}> {
  // Date-only prices are stored at UTC midnight, so the end of that UTC day
  // takes in every price effective "on" the date (as in costRun).
  const found = await ItemPriceRepository.findPricesAsOf([...consumption.keys()], new Date(`${pricedOn}T23:59:59.999Z`), null)
  const prices  = new Map<string, Prisma.Decimal>()
  const missing: string[] = []
  let total: Prisma.Decimal | null = new Prisma.Decimal(0)
  for (const [materialId, { item, quantity }] of consumption) {
    const price = found.get(materialId)
    if (!price) {
      missing.push(item.material.name)
      total = null
      continue
    }
    prices.set(materialId, price.unitPrice)
    if (total !== null) total = total.add(quantity.mul(price.unitPrice))
  }
  return { prices, total, missing }
}

/**
 * The source lots at the branch against what is required, as of `now`:
 * planned with planFefoTakes, the rule approval re-applies under lock —
 * soonest expiry first, expired skipped (D6). The source cost is what those
 * lots were recorded at (D7).
 */
async function sourceAt(
  sourceFinishedGoodId: string,
  branchId: string,
  required: Prisma.Decimal | null,
  excludeOrderId: string | null,
  now: Date,
): Promise<{
  dto: Omit<ConversionEffectDto['source'], 'finishedGoodName' | 'unitAbbreviation'>
  available: Prisma.Decimal
  /** Null while there is no requirement, the lots fall short, or one taken has no cost. */
  cost: Prisma.Decimal | null
}> {
  const zero = new Prisma.Decimal(0)
  const [levels, pendingConversions, pendingWriteOffs] = await Promise.all([
    FinishedGoodStockRepository.lotsOnHand(sourceFinishedGoodId, branchId),
    ConversionOrderRepository.pendingSourceAtBranch(sourceFinishedGoodId, branchId, excludeOrderId),
    WriteOffRepository.pendingOnUnexpiredLots(sourceFinishedGoodId, branchId, now),
  ])
  const pending = pendingConversions.add(pendingWriteOffs)
  const plan  = planFefoTakes(levels, required ?? zero, now)
  const taken = new Map(plan.takes.map(take => [take.lot.id, take.quantity]))

  let unexpired = zero
  let expired   = zero
  let cost: Prisma.Decimal | null = required === null || plan.short.greaterThan(0) ? null : zero
  const lots = levels.map<SourceLotDto>(level => {
    const isExpired = level.lot.expiresAt !== null && level.lot.expiresAt <= now
    if (isExpired) expired = expired.add(level.quantity)
    else unexpired = unexpired.add(level.quantity)
    const take     = taken.get(level.lot.id) ?? zero
    const unitCost = level.lot.movements[0]?.unitCost ?? null
    if (cost !== null && take.greaterThan(0)) cost = unitCost === null ? null : cost.add(take.mul(unitCost))
    return {
      lotNumber: level.lot.lotNumber,
      expiresAt: level.lot.expiresAt?.toISOString() ?? null,
      onHand:    toDecimalString(level.quantity),
      expired:   isExpired,
      expiry:    expiryFlag(level.lot.expiresAt, now.getTime()),
      take:      toDecimalString(take),
      unitCost:  unitCost === null ? null : toDecimalString(unitCost),
    }
  })

  const available = unexpired.sub(pending)
  return {
    available,
    cost,
    dto: {
      required:        required === null ? null : toDecimalString(required),
      unexpiredOnHand: toDecimalString(unexpired),
      expiredOnHand:   toDecimalString(expired),
      pending:         toDecimalString(pending),
      available:       toDecimalString(available),
      enough:          required === null ? null : required.lessThanOrEqualTo(available),
      lots,
    },
  }
}

/** See ConversionEffectDto. `convertedAt` starts the output's shelf life and dates the prices. */
async function conversionEffect(input: {
  bom: BomWithDetail
  branch: { id: string; name: string }
  output: { name: string; unitAbbreviation: string; shelfLifeHours: number | null }
  sourceQty: Prisma.Decimal | null
  outputQty: Prisma.Decimal | null
  convertedAt: Date
  excludeOrderId: string | null
}): Promise<ConversionEffectDto> {
  const { bom, branch, output, sourceQty, outputQty } = input
  const sourceGood = bom.sourceFinishedGood
  const zero     = new Prisma.Decimal(0)
  const pricedOn = isoDateAt(input.convertedAt)

  const consumption: Consumption = sourceQty === null ? new Map() : addedIngredients(bom, sourceQty)
  const [source, onHand, priced] = await Promise.all([
    sourceGood === null
      ? null
      : sourceAt(sourceGood.id, branch.id, sourceQty, input.excludeOrderId, new Date()),
    InventoryRepository.levelsAtBranch(branch.id, [...consumption.keys()]),
    priceIngredients(consumption, pricedOn),
  ])

  const ingredients = [...consumption.values()].map(({ item, quantity }) => {
    const lineOnHand = onHand.get(item.materialId) ?? zero
    const after      = lineOnHand.sub(quantity)
    const price      = priced.prices.get(item.materialId)
    return {
      materialId:       item.materialId,
      materialCode:     item.material.code,
      materialName:     item.material.name,
      unitAbbreviation: item.unit.abbreviation,
      deduct:           toDecimalString(quantity),
      onHand:           toDecimalString(lineOnHand),
      after:            toDecimalString(after),
      goesNegative:     after.lessThan(0),
      unitPrice:        price === undefined ? null : toDecimalString(price),
    }
  })

  const expected  = sourceQty === null ? null : expectedOutput(bom, sourceQty)
  const expiresAt = outputExpiry(input.convertedAt, output.shelfLifeHours)
  const sourceCost = source?.cost ?? null
  const total = sourceCost !== null && priced.total !== null ? sourceCost.add(priced.total) : null

  return {
    branchName: branch.name,
    source: {
      finishedGoodName: sourceGood?.name ?? '—',
      unitAbbreviation: sourceGood?.unit.abbreviation ?? '',
      ...(source?.dto ?? {
        required: null, unexpiredOnHand: '0', expiredOnHand: '0', pending: '0', available: '0', enough: null, lots: [],
      }),
    },
    ingredients,
    negativeCount: ingredients.filter(line => line.goesNegative).length,
    cost: sourceQty === null ? null : {
      pricedOn,
      sourceCost:     sourceCost === null ? null : toDecimalString(sourceCost),
      conversionCost: priced.total === null ? null : toDecimalString(priced.total),
      missing:        priced.missing,
      total:          total === null ? null : toDecimalString(total),
      perUnit:        total === null || outputQty === null ? null : toDecimalString(total.div(outputQty)),
    },
    output: {
      finishedGoodName:  output.name,
      unitAbbreviation:  output.unitAbbreviation,
      expected:          expected === null ? null : toDecimalString(expected),
      quantity:          outputQty === null ? null : toDecimalString(outputQty),
      percentOfExpected: expected === null || outputQty === null || expected.isZero()
        ? null
        : toDecimalString(outputQty.div(expected).mul(100).toDecimalPlaces(1)),
      expiresAt:         expiresAt?.toISOString() ?? null,
      shelfLifeHours:    output.shelfLifeHours,
    },
  }
}

function toSummaryDto(order: ConversionOrderWithDetail): ConversionOrderSummaryDto {
  const expected = expectedOutput(order.bom, order.sourceQty) ?? order.outputQty
  return {
    id:                     order.id,
    orderNumber:            order.orderNumber,
    status:                 order.status,
    finishedGoodId:         order.finishedGood.id,
    finishedGoodCode:       order.finishedGood.code,
    finishedGoodName:       order.finishedGood.name,
    unitAbbreviation:       order.finishedGood.unit.abbreviation,
    sourceFinishedGoodId:   order.sourceFinishedGood.id,
    sourceCode:             order.sourceFinishedGood.code,
    sourceName:             order.sourceFinishedGood.name,
    sourceUnitAbbreviation: order.sourceFinishedGood.unit.abbreviation,
    bomId:                  order.bom.id,
    bomVersion:             order.bom.version,
    sourceQty:              toDecimalString(order.sourceQty),
    outputQty:              toDecimalString(order.outputQty),
    expectedOutput:         toDecimalString(expected),
    percentOfExpected:      toDecimalString(order.outputQty.div(expected).mul(100).toDecimalPlaces(1)),
    branchId:               order.branch.id,
    branchName:             order.branch.name,
    submittedById:          order.submittedBy.id,
    submittedByName:        order.submittedBy.name,
    createdAt:              order.createdAt.toISOString(),
    convertedOn:            isoDateAt(order.createdAt),
  }
}

/** Both ledgers' rows for an approved conversion. */
async function conversionStock(orderId: string): Promise<ConversionStockDto> {
  const [materials, finished] = await Promise.all([
    InventoryRepository.findMovementsByReference('ConversionOrder', orderId),
    FinishedGoodStockRepository.findMovementsByReference('ConversionOrder', orderId),
  ])
  const lotIn = finished.find(movement => movement.quantity.greaterThan(0))

  return {
    sourceLots: finished.filter(movement => movement.quantity.lessThan(0)).map(movement => ({
      id:               movement.id,
      lotNumber:        movement.lot.lotNumber,
      quantity:         toDecimalString(movement.quantity),
      unitAbbreviation: movement.lot.finishedGood.unit.abbreviation,
      unitCost:         movement.unitCost === null ? null : toDecimalString(movement.unitCost),
    })),
    ingredients: materials.map(movement => ({
      id:               movement.id,
      materialId:       movement.materialId,
      branchId:         movement.branchId,
      materialCode:     movement.material.code,
      materialName:     movement.material.name,
      unitAbbreviation: movement.material.unit.abbreviation,
      quantity:         toDecimalString(movement.quantity),
      unitCost:         movement.unitCost === null ? null : toDecimalString(movement.unitCost),
    })),
    lot: lotIn ? {
      lotNumber:        lotIn.lot.lotNumber,
      quantity:         toDecimalString(lotIn.quantity),
      unitAbbreviation: lotIn.lot.finishedGood.unit.abbreviation,
      producedOn:       lotIn.lot.producedOn.toISOString().slice(0, 10),
      branchName:       lotIn.branch.name,
      unitCost:         lotIn.unitCost === null ? null : toDecimalString(lotIn.unitCost),
      expiresAt:        lotIn.lot.expiresAt?.toISOString() ?? null,
    } : null,
  }
}

/** The effect of approving a pending order now, from its pinned recipe. */
async function pendingEffect(order: ConversionOrderWithDetail, bom: BomWithDetail): Promise<ConversionEffectDto> {
  return conversionEffect({
    bom,
    branch:         order.branch,
    output:         { name: order.finishedGood.name, unitAbbreviation: order.finishedGood.unit.abbreviation, shelfLifeHours: order.finishedGood.shelfLifeHours },
    sourceQty:      order.sourceQty,
    outputQty:      order.outputQty,
    convertedAt:    order.createdAt,
    excludeOrderId: order.id,
  })
}

/**
 * Queues a notification job after the change it reports has committed. A
 * queue failure never fails the user's action (docs/architecture.md): the
 * conversion is already recorded or decided, so a missing notification is a
 * degraded nicety, not a reason to undo it.
 */
async function enqueue(jobName: string, conversionOrderId: string): Promise<void> {
  try {
    await getNotificationQueue().add(jobName, { conversionOrderId } satisfies ConversionOrderJob)
  } catch (err) {
    console.error(`[ConversionOrderService] could not enqueue ${jobName}`, err)
  }
}

/**
 * The recipe and branch a conversion names, checked: an ACTIVE CONVERSION
 * version (the one the order pins) whose output is active, and an active
 * branch. Shared by the preview and create.
 */
async function recipeAndBranch(bomId: string, branchId: string): Promise<ConversionOrderResult<{
  bom: BomWithDetail
  branch: { id: string; name: string }
}>> {
  const [bom, branch] = await Promise.all([BomRepository.findById(bomId), BranchRepository.findById(branchId)])

  if (!bom || bom.kind !== BomKind.CONVERSION || bom.sourceFinishedGood === null || bom.sourceQuantity === null) {
    return { success: false, error: 'Conversion recipe not found', status: 400 }
  }
  if (!bom.isActive) {
    return { success: false, error: `${bom.finishedGood.name} Conversion v${bom.version} has been replaced by a newer version — reload and choose it again`, status: 409 }
  }
  if (!branch || !branch.isActive) {
    return { success: false, error: 'Branch not found', status: 400 }
  }
  return { success: true, data: { bom, branch } }
}

export const ConversionOrderService = {
  /** Newest first. No viewer scoping, like production orders. */
  async list(filters: ConversionOrderListFilters = {}) {
    const { rows, total } = await ConversionOrderRepository.findMany(filters)
    return { conversionOrders: rows.map(toSummaryDto), total }
  },

  async getById(id: string): Promise<ConversionOrderResult<ConversionOrderDetailDto>> {
    const order = await ConversionOrderRepository.findById(id)
    if (!order) {
      return { success: false, error: 'Conversion order not found', status: 404 }
    }

    const isPending  = order.status === ConversionStatus.PENDING_APPROVAL
    const isApproved = order.status === ConversionStatus.APPROVED
    const [bom, decisions, stockMoved] = await Promise.all([
      // The pinned version with its lines, for the preview.
      isPending ? BomRepository.findById(order.bom.id) : null,
      ApprovalRepository.findByReference('ConversionOrder', order.id),
      isApproved ? conversionStock(order.id) : null,
    ])
    // BOM rows are never deleted, so this is only true in a hand-edited database.
    if (isPending && !bom) {
      return { success: false, error: 'The recipe this conversion is pinned to no longer exists', status: 404 }
    }

    const { sourceCost, conversionCost, costPerUnit } = order
    return {
      success: true,
      data: {
        ...toSummaryDto(order),
        notes:  order.notes,
        effect: bom ? await pendingEffect(order, bom) : null,
        decisions: decisions.map(decision => ({
          id:           decision.id,
          decision:     decision.decision,
          remarks:      decision.remarks,
          approverName: decision.approver.name,
          decidedAt:    decision.decidedAt.toISOString(),
        })),
        stockMoved,
        // Recorded at approval and never recomputed (D7).
        recordedCost: sourceCost !== null && conversionCost !== null && costPerUnit !== null ? {
          sourceCost:     toDecimalString(sourceCost),
          conversionCost: toDecimalString(conversionCost),
          total:          toDecimalString(sourceCost.add(conversionCost)),
          costPerUnit:    toDecimalString(costPerUnit),
        } : null,
      },
    }
  },

  /**
   * The approvals inbox's conversions (D9), oldest first, each with what
   * approving now would do — the same figures as the order page. A few
   * queries per order, bounded by `take`, like production completions.
   */
  async listPending(take = 100): Promise<PendingConversionDto[]> {
    const orders = await ConversionOrderRepository.findPending(take)
    const rows = await Promise.all(orders.map(async order => {
      const bom = await BomRepository.findById(order.bom.id)
      if (!bom) return null
      const effect = await pendingEffect(order, bom)
      return {
        ...toSummaryDto(order),
        sourceEnough:    effect.source.enough === true,
        ingredientCount: effect.ingredients.length,
        negativeCount:   effect.negativeCount,
        costPerUnit:     effect.cost?.perUnit ?? null,
        missingPrices:   effect.cost?.missing.length ?? 0,
      }
    }))
    return rows.flatMap(row => (row === null ? [] : [row]))
  },

  /** What the form offers: active conversion recipes and active branches. */
  async getForm(): Promise<ConversionFormDto> {
    const [boms, branches] = await Promise.all([
      BomRepository.findAllActiveConversions(),
      BranchRepository.findAllActive(),
    ])

    return {
      recipes: boms.flatMap<ConversionRecipeDto>(bom =>
        bom.sourceFinishedGood === null || bom.sourceQuantity === null ? [] : [{
          bomId:                  bom.id,
          version:                bom.version,
          finishedGoodId:         bom.finishedGood.id,
          finishedGoodCode:       bom.finishedGood.code,
          finishedGoodName:       bom.finishedGood.name,
          unitAbbreviation:       bom.batchUnit.abbreviation,
          batchSize:              toDecimalString(bom.batchSize),
          sourceFinishedGoodId:   bom.sourceFinishedGood.id,
          sourceCode:             bom.sourceFinishedGood.code,
          sourceName:             bom.sourceFinishedGood.name,
          sourceUnitAbbreviation: bom.sourceFinishedGood.unit.abbreviation,
          sourceQuantity:         toDecimalString(bom.sourceQuantity),
        }],
      ),
      branches,
    }
  },

  /**
   * The form's live preview. Read-only. Quantities are optional so the form
   * can show what is on hand as soon as a recipe and branch are chosen.
   */
  async preview(input: {
    bomId: string
    branchId: string
    sourceQty?: string
    outputQty?: string
  }): Promise<ConversionOrderResult<ConversionPreviewDto>> {
    const checked = await recipeAndBranch(input.bomId, input.branchId)
    if (!checked.success) return checked
    const { bom, branch } = checked.data

    const sourceQty = input.sourceQty === undefined ? null : toDecimal(input.sourceQty)
    const outputQty = input.outputQty === undefined ? null : toDecimal(input.outputQty)

    return {
      success: true,
      data: {
        bomId:      bom.id,
        bomVersion: bom.version,
        effect: await conversionEffect({
          bom,
          branch,
          output:         { name: bom.finishedGood.name, unitAbbreviation: bom.batchUnit.abbreviation, shelfLifeHours: bom.finishedGood.shelfLifeHours },
          sourceQty:      sourceQty !== null && sourceQty.greaterThan(0) ? sourceQty : null,
          outputQty:      outputQty !== null && outputQty.greaterThan(0) ? outputQty : null,
          convertedAt:    new Date(),
          excludeOrderId: null,
        }),
      },
    }
  },

  /**
   * Records a conversion that has happened and submits it, in one step (D4):
   * created PENDING_APPROVAL, the caller as submitter. The source must be on
   * hand, unexpired, at the branch, less what other pending conversions there
   * have claimed (D5); approval checks it again, under a lock, because lots
   * can expire or be used meanwhile. Added ingredients may go negative, as in
   * production. Nothing moves in stock here.
   */
  async create(
    input: CreateConversionOrderServiceInput,
    viewer: Viewer,
  ): Promise<ConversionOrderResult<{ id: string; orderNumber: string }>> {
    if (!canConvert(viewer.role)) {
      return { success: false, error: 'Only production can record a conversion', status: 403 }
    }

    const checked = await recipeAndBranch(input.bomId, input.branchId)
    if (!checked.success) return checked
    const { bom, branch } = checked.data
    // recipeAndBranch guarantees both; repeated so TypeScript knows.
    if (bom.sourceFinishedGood === null || bom.sourceQuantity === null) {
      return { success: false, error: 'Conversion recipe not found', status: 400 }
    }
    const sourceUnit = bom.sourceFinishedGood.unit.abbreviation
    const outputUnit = bom.batchUnit.abbreviation

    const sourceQty = toDecimal(input.sourceQty)
    const outputQty = toDecimal(input.outputQty)
    if (sourceQty.lessThanOrEqualTo(0)) {
      return { success: false, error: `Enter how much ${bom.sourceFinishedGood.name} was used`, status: 400 }
    }
    if (outputQty.lessThanOrEqualTo(0)) {
      return { success: false, error: `Enter how much ${bom.finishedGood.name} was made — a conversion that made nothing is a write-off`, status: 400 }
    }
    const expected  = bom.batchSize.mul(sourceQty).div(bom.sourceQuantity)
    const maxOutput = expected.mul(MAX_OUTPUT_FACTOR)
    if (outputQty.greaterThan(maxOutput)) {
      return {
        success: false,
        error:   `${trimDecimal(toDecimalString(sourceQty))} ${sourceUnit} ${bom.sourceFinishedGood.name} should make about ${trimDecimal(toDecimalString(expected))} ${outputUnit} — the output cannot be more than ${MAX_OUTPUT_FACTOR} × that (${trimDecimal(toDecimalString(maxOutput))} ${outputUnit}). Check the figure`,
        status:  400,
      }
    }

    const source = await sourceAt(bom.sourceFinishedGood.id, branch.id, sourceQty, null, new Date())
    if (sourceQty.greaterThan(source.available)) {
      return {
        success: false,
        error:   `Only ${trimDecimal(source.dto.available)} ${sourceUnit} of unexpired ${bom.sourceFinishedGood.name} is available at ${branch.name}`
          + (toDecimal(source.dto.pending).greaterThan(0) ? ` (${trimDecimal(source.dto.unexpiredOnHand)} on hand, ${trimDecimal(source.dto.pending)} claimed by conversions or write-offs awaiting approval)` : '')
          + ` — you entered ${trimDecimal(toDecimalString(sourceQty))} ${sourceUnit}`,
        status:  400,
      }
    }

    const created = await ConversionOrderRepository.create({
      bomId:                bom.id,
      finishedGoodId:       bom.finishedGoodId,
      sourceFinishedGoodId: bom.sourceFinishedGood.id,
      branchId:             branch.id,
      submittedById:        viewer.userId,
      sourceQty,
      outputQty,
      notes:                input.notes ?? null,
    })

    await enqueue(CONVERSION_ORDER_SUBMITTED, created.id)
    return { success: true, data: created }
  },

  /**
   * Accounting's decision (D6), from POST /api/approvals with referenceType
   * 'ConversionOrder', which middleware restricts to ACCOUNTING and ADMIN.
   * Never whoever recorded it, ADMIN included; a reason to reject; REJECTED
   * is final — production records the conversion again, corrected.
   *
   * Approving needs, before anything is written: the output's shelf life (the
   * new lot's expiry, D8) and a reference price on the conversion date for
   * every added ingredient (D7) — refused with 409 otherwise, as for
   * production. The source is re-checked inside the transaction, under lock.
   */
  async applyDecision(
    id: string,
    viewer: Viewer,
    decision: 'APPROVED' | 'REJECTED',
    remarks: string | null,
  ): Promise<ConversionOrderResult<{ id: string; orderNumber: string }>> {
    const order = await ConversionOrderRepository.findById(id)
    if (!order) {
      return { success: false, error: 'Conversion order not found', status: 404 }
    }
    if (order.submittedBy.id === viewer.userId) {
      return { success: false, error: 'You recorded this conversion, so someone else has to decide it', status: 403 }
    }
    if (order.status !== ConversionStatus.PENDING_APPROVAL) {
      return {
        success: false,
        error:   `This conversion is ${order.status.replace(/_/g, ' ').toLowerCase()} and is no longer awaiting a decision`,
        status:  409,
      }
    }
    if (decision === 'REJECTED' && (remarks === null || remarks.trim() === '')) {
      return { success: false, error: 'Give a reason when rejecting, so production knows what to correct', status: 400 }
    }

    let result: ConversionDecideResult
    if (decision === 'REJECTED') {
      result = await ConversionOrderRepository.decide({ id, approverId: viewer.userId, remarks, decision: { kind: 'REJECTED' } })
    } else {
      const expiresAt = outputExpiry(order.createdAt, order.finishedGood.shelfLifeHours)
      if (expiresAt === null) {
        return {
          success: false,
          error:   `${order.finishedGood.name} has no shelf life — an admin sets it in Master Data (Finished Goods), then approve`,
          status:  409,
        }
      }

      const bom = await BomRepository.findById(order.bom.id)
      if (!bom) {
        return { success: false, error: 'The recipe this conversion is pinned to no longer exists', status: 404 }
      }
      const consumption = addedIngredients(bom, order.sourceQty)
      const convertedOn = isoDateAt(order.createdAt)
      const priced = await priceIngredients(consumption, convertedOn)
      if (priced.total === null) {
        return {
          success: false,
          error:   `No reference price for ${priced.missing.map(name => `${name} on ${convertedOn}`).join(', ')} — an admin adds one in Master Data (it may be back-dated), then approve`,
          status:  409,
        }
      }

      result = await ConversionOrderRepository.decide({
        id,
        approverId: viewer.userId,
        remarks,
        decision: {
          kind: 'APPROVED',
          approval: {
            orderNumber:          order.orderNumber,
            branchId:             order.branch.id,
            sourceFinishedGoodId: order.sourceFinishedGood.id,
            sourceQty:            order.sourceQty,
            sourceLabel:          { name: order.sourceFinishedGood.name, unitAbbreviation: order.sourceFinishedGood.unit.abbreviation },
            ingredients:          [...consumption].flatMap(([materialId, line]) => {
              // Always present: priced.total is non-null only when every line was priced.
              const unitCost = priced.prices.get(materialId)
              return unitCost ? [{ materialId, quantity: line.quantity, unitCost }] : []
            }),
            conversionCost:       priced.total,
            output: {
              finishedGoodId: order.finishedGood.id,
              quantity:       order.outputQty,
              // The Manila day it was converted, stored as UTC midnight.
              producedOn:     new Date(convertedOn),
              expiresAt,
            },
            now: new Date(),
          },
        },
      })
    }

    if (!result.ok) {
      return result.reason === 'not-pending'
        ? { success: false, error: 'This conversion was decided by someone else just now — reload', status: 409 }
        : { success: false, error: result.message, status: 409 }
    }

    await enqueue(CONVERSION_ORDER_DECIDED, id)
    return { success: true, data: { id: order.id, orderNumber: order.orderNumber } }
  },
}
