import { BomKind, Prisma } from '@prisma/client'
import { toDecimal, toDecimalString } from '@/lib/decimal'
import { BomRepository, BomWithDetail, BomListFilters } from '@/repositories/bom.repository'
import { FinishedGoodRepository } from '@/repositories/finished-good.repository'
import { MaterialRepository } from '@/repositories/material.repository'
import { ItemPriceRepository } from '@/repositories/item-price.repository'

export type BomLineDto = {
  id: string
  materialId: string
  materialCode: string
  materialName: string
  unitId: string
  unitAbbreviation: string
  /** Quantity as authored, for one batch of batchSize. */
  batchQuantity: string
  /** batchQuantity × (targetQuantity / batchSize). Equals batchQuantity at scale 1. */
  scaledQuantity: string
  /** Reference price × scaledQuantity, or null if the material has no price yet. */
  lineCost: string | null
  notes: string | null
}

/**
 * A conversion recipe's source line (Week 7 Task 1, D2): the finished good it
 * is made from, per batch and scaled like the ingredient lines. Not priced
 * here — a source is costed at approval from the lots actually taken, at
 * their recorded cost (D7), not at a reference price.
 */
export type BomSourceDto = {
  finishedGoodId: string
  code: string
  name: string
  unitAbbreviation: string
  /** Per batch of batchSize, as authored. */
  batchQuantity: string
  /** batchQuantity × (targetQuantity / batchSize). */
  scaledQuantity: string
}

export type BomDetailDto = {
  id: string
  kind: BomKind
  version: number
  isActive: boolean
  finishedGoodId: string
  finishedGoodCode: string
  finishedGoodName: string
  batchSize: string
  batchUnitId: string
  batchUnitAbbreviation: string
  notes: string | null
  createdAt: string
  /** The quantity the lines below were scaled to. Defaults to batchSize. */
  targetQuantity: string
  /** CONVERSION only; null for a production recipe. */
  source: BomSourceDto | null
  lines: BomLineDto[]
  /**
   * Sum of lineCost. Null if ANY line is unpriced — a partial total misleads.
   * For a conversion recipe, the added ingredients only (the source is not
   * priced here, see BomSourceDto).
   */
  totalCost: string | null
  /** totalCost / targetQuantity, in Decimal. Week 6 costing compares against this. */
  costPerUnit: string | null
}

export type BomSummaryDto = {
  id: string
  kind: BomKind
  version: number
  isActive: boolean
  finishedGoodId: string
  finishedGoodCode: string
  finishedGoodName: string
  batchSize: string
  batchUnitAbbreviation: string
  /** CONVERSION only: "6 kg Lechon" per batch. */
  source: { name: string; quantity: string; unitAbbreviation: string } | null
  lineCount: number
  createdAt: string
}

export type BomVersionDto = {
  id: string
  kind: BomKind
  version: number
  isActive: boolean
  batchSize: string
  batchUnitAbbreviation: string
  lineCount: number
  createdAt: string
}

export type CreateBomServiceInput = {
  finishedGoodId: string
  /** Defaults to PRODUCTION. */
  kind?: BomKind
  /** CONVERSION only, both required: the finished good converted and how much of it one batch uses. */
  sourceFinishedGoodId?: string | null
  sourceQuantity?: string | null
  batchSize: string
  batchUnitId: string
  notes?: string | null
  items: {
    materialId: string
    quantity: string
    unitId: string
    notes?: string | null
  }[]
}

export type BomResult<T> =
  | { success: true;  data: T }
  | { success: false; error: string; status: number }

/**
 * Scales a BOM's lines to a target output quantity.
 *
 * Exported on its own because Week 5 needs exactly this to derive a production
 * order's material requirements. Writing it here once means the scaled viewer
 * and the production order cannot disagree about what a 25 kg batch requires.
 *
 * All arithmetic stays in Prisma.Decimal. Doing it in the browser with JS
 * numbers would reintroduce float error into quantities that Weeks 6–8 then
 * cost — which is why the viewer passes a target quantity to the server rather
 * than multiplying client-side.
 */
export function scaleBomQuantities(
  bom: BomWithDetail,
  targetQuantity: Prisma.Decimal,
): { quantity: Prisma.Decimal; lineId: string }[] {
  const factor = targetQuantity.div(bom.batchSize)
  return bom.items.map(item => ({
    lineId:   item.id,
    quantity: item.quantity.mul(factor),
  }))
}

async function toDetailDto(
  bom: BomWithDetail,
  targetQuantity: Prisma.Decimal,
): Promise<BomDetailDto> {
  const scaled = new Map(scaleBomQuantities(bom, targetQuantity).map(s => [s.lineId, s.quantity]))

  // One query for every line's price, not one per line.
  const prices = await ItemPriceRepository.findPricesAsOf(
    bom.items.map(item => item.materialId),
    new Date(),
  )

  let runningTotal = new Prisma.Decimal(0)
  let everyLinePriced = true

  const lines: BomLineDto[] = bom.items.map(item => {
    const scaledQuantity = scaled.get(item.id) ?? item.quantity
    const price = prices.get(item.materialId)

    let lineCost: string | null = null
    if (price) {
      const cost = price.unitPrice.mul(scaledQuantity)
      runningTotal = runningTotal.add(cost)
      lineCost = toDecimalString(cost)
    } else {
      everyLinePriced = false
    }

    return {
      id:               item.id,
      materialId:       item.materialId,
      materialCode:     item.material.code,
      materialName:     item.material.name,
      unitId:           item.unitId,
      unitAbbreviation: item.unit.abbreviation,
      batchQuantity:    toDecimalString(item.quantity),
      scaledQuantity:   toDecimalString(scaledQuantity),
      lineCost,
      notes:            item.notes,
    }
  })

  const source = bom.sourceFinishedGood !== null && bom.sourceQuantity !== null
    ? {
        finishedGoodId:   bom.sourceFinishedGood.id,
        code:             bom.sourceFinishedGood.code,
        name:             bom.sourceFinishedGood.name,
        unitAbbreviation: bom.sourceFinishedGood.unit.abbreviation,
        batchQuantity:    toDecimalString(bom.sourceQuantity),
        scaledQuantity:   toDecimalString(bom.sourceQuantity.mul(targetQuantity.div(bom.batchSize))),
      }
    : null

  return {
    id:                    bom.id,
    kind:                  bom.kind,
    version:               bom.version,
    isActive:              bom.isActive,
    finishedGoodId:        bom.finishedGoodId,
    finishedGoodCode:      bom.finishedGood.code,
    finishedGoodName:      bom.finishedGood.name,
    batchSize:             toDecimalString(bom.batchSize),
    batchUnitId:           bom.batchUnitId,
    batchUnitAbbreviation: bom.batchUnit.abbreviation,
    notes:                 bom.notes,
    createdAt:             bom.createdAt.toISOString(),
    targetQuantity:        toDecimalString(targetQuantity),
    source,
    lines,
    totalCost:             everyLinePriced ? toDecimalString(runningTotal) : null,
    // Divided here in Decimal rather than in the view with JS numbers — cost
    // per kg feeds Week 6 variance, so it must not carry float error.
    costPerUnit:           everyLinePriced
      ? toDecimalString(runningTotal.div(targetQuantity))
      : null,
  }
}

/**
 * The source line of a recipe (Week 7 Task 1, D2). A production recipe has
 * none. A conversion recipe names an active finished good other than its own
 * output, with a quantity per batch in that good's unit; and its batch unit
 * must be the output's own unit, because a conversion puts its output into
 * stock in that unit and there is no unit conversion (production checks the
 * same when an order is planned).
 */
async function checkSource(
  input: CreateBomServiceInput,
  kind: BomKind,
  good: { id: string; name: string; unitId: string; unit: { abbreviation: string } },
): Promise<BomResult<{ finishedGoodId: string; quantity: Prisma.Decimal } | null>> {
  const hasSource = Boolean(input.sourceFinishedGoodId) || Boolean(input.sourceQuantity)

  if (kind === BomKind.PRODUCTION) {
    return hasSource
      ? { success: false, error: 'A production BOM has no source finished good — send kind CONVERSION for a conversion recipe', status: 400 }
      : { success: true, data: null }
  }

  if (!input.sourceFinishedGoodId || !input.sourceQuantity) {
    return { success: false, error: 'A conversion BOM needs the finished good it converts and how much of it one batch uses', status: 400 }
  }
  if (input.sourceFinishedGoodId === good.id) {
    return { success: false, error: `${good.name} cannot be converted into itself`, status: 400 }
  }
  const quantity = toDecimal(input.sourceQuantity)
  if (quantity.lessThanOrEqualTo(0)) {
    return { success: false, error: 'The source quantity per batch must be greater than zero', status: 400 }
  }
  if (input.batchUnitId !== good.unitId) {
    return {
      success: false,
      error:   `${good.name} is stocked in ${good.unit.abbreviation}, so its conversion batch must be stated in ${good.unit.abbreviation} — unit conversion is not supported yet`,
      status:  400,
    }
  }

  const sourceGood = await FinishedGoodRepository.findById(input.sourceFinishedGoodId)
  if (!sourceGood || !sourceGood.isActive) {
    return { success: false, error: 'Source finished good not found', status: 400 }
  }

  return { success: true, data: { finishedGoodId: sourceGood.id, quantity } }
}

export const BomService = {
  async list(filters: BomListFilters = {}) {
    const { rows, total } = await BomRepository.findMany(filters)

    return {
      boms: rows.map<BomSummaryDto>(bom => ({
        id:                    bom.id,
        kind:                  bom.kind,
        version:               bom.version,
        isActive:              bom.isActive,
        finishedGoodId:        bom.finishedGoodId,
        finishedGoodCode:      bom.finishedGood.code,
        finishedGoodName:      bom.finishedGood.name,
        batchSize:             toDecimalString(bom.batchSize),
        batchUnitAbbreviation: bom.batchUnit.abbreviation,
        source:                bom.sourceFinishedGood !== null && bom.sourceQuantity !== null
          ? {
              name:             bom.sourceFinishedGood.name,
              quantity:         toDecimalString(bom.sourceQuantity),
              unitAbbreviation: bom.sourceFinishedGood.unit.abbreviation,
            }
          : null,
        lineCount:             bom._count.items,
        createdAt:             bom.createdAt.toISOString(),
      })),
      total,
    }
  },

  /**
   * `targetQuantity` omitted means "show the BOM as authored" — scale factor 1.
   */
  async getById(id: string, targetQuantity?: string): Promise<BomResult<BomDetailDto>> {
    const bom = await BomRepository.findById(id)
    if (!bom) {
      return { success: false, error: 'BOM not found', status: 404 }
    }

    let target = bom.batchSize
    if (targetQuantity !== undefined) {
      const parsed = toDecimal(targetQuantity)
      if (parsed.lessThanOrEqualTo(0)) {
        return { success: false, error: 'Target quantity must be greater than zero', status: 400 }
      }
      target = parsed
    }

    return { success: true, data: await toDetailDto(bom, target) }
  },

  /** Every version of every kind, or of one kind when given (each kind numbers its own). */
  async versions(finishedGoodId: string, kind?: BomKind): Promise<BomResult<BomVersionDto[]>> {
    const good = await FinishedGoodRepository.findById(finishedGoodId)
    if (!good) {
      return { success: false, error: 'Finished good not found', status: 404 }
    }

    const versions = await BomRepository.findVersions(finishedGoodId, kind)

    return {
      success: true,
      data: versions.map(v => ({
        id:                    v.id,
        kind:                  v.kind,
        version:               v.version,
        isActive:              v.isActive,
        batchSize:             toDecimalString(v.batchSize),
        batchUnitAbbreviation: v.batchUnit.abbreviation,
        lineCount:             v._count.items,
        createdAt:             v.createdAt.toISOString(),
      })),
    }
  },

  /**
   * Creates a BOM version. Also the edit path — there is no update, because
   * ProductionOrder pins bomId and rewriting a used BOM would rewrite history.
   */
  async createVersion(input: CreateBomServiceInput): Promise<BomResult<BomDetailDto>> {
    const good = await FinishedGoodRepository.findById(input.finishedGoodId)
    if (!good) {
      return { success: false, error: 'Finished good not found', status: 404 }
    }

    const batchSize = toDecimal(input.batchSize)
    if (batchSize.lessThanOrEqualTo(0)) {
      // Guarded here rather than only at the form: batchSize is the divisor in
      // every scale calculation, so zero would make the viewer return Infinity.
      return { success: false, error: 'Batch size must be greater than zero', status: 400 }
    }

    const kind   = input.kind ?? BomKind.PRODUCTION
    const source = await checkSource(input, kind, good)
    if (!source.success) return source

    if (input.items.length === 0) {
      return { success: false, error: 'A BOM needs at least one ingredient line', status: 400 }
    }

    const materialIds = input.items.map(item => item.materialId)
    if (new Set(materialIds).size !== materialIds.length) {
      return { success: false, error: 'The same material appears on more than one line', status: 400 }
    }

    // Every referenced material is fetched in ONE query, then validated in
    // memory. Calling findById per line would be an N+1 that grows with recipe
    // size — a 20-ingredient BOM would issue 20 queries just to validate.
    //
    // The unit check matters because Week 2 has no unit-conversion layer: a
    // line authored in grams against a material stocked in kg would silently
    // produce quantities 1000x wrong once Weeks 5-8 start costing them.
    const materials = await MaterialRepository.findManyByIds(materialIds)

    for (const item of input.items) {
      const material = materials.get(item.materialId)
      if (!material) {
        return { success: false, error: `Material ${item.materialId} not found`, status: 400 }
      }
      if (material.unitId !== item.unitId) {
        return {
          success: false,
          error: `Line unit for ${material.name} must match the material's stocking unit (${material.unit.abbreviation}) — unit conversion is not supported yet`,
          status: 400,
        }
      }
      if (toDecimal(item.quantity).lessThanOrEqualTo(0)) {
        return { success: false, error: `Quantity for ${material.name} must be greater than zero`, status: 400 }
      }
    }

    const bom = await BomRepository.createVersion({
      finishedGoodId: input.finishedGoodId,
      kind,
      source:         source.data,
      batchSize,
      batchUnitId:    input.batchUnitId,
      notes:          input.notes ?? null,
      items: input.items.map(item => ({
        materialId: item.materialId,
        quantity:   toDecimal(item.quantity),
        unitId:     item.unitId,
        notes:      item.notes ?? null,
      })),
    })

    return { success: true, data: await toDetailDto(bom, bom.batchSize) }
  },
}
