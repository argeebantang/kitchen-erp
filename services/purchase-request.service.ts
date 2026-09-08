import { Prisma, PRStatus } from '@prisma/client'
import { toDecimal, toDecimalString, toNullableDecimalString } from '@/lib/decimal'
import {
  PurchaseRequestRepository,
  PurchaseRequestListFilters,
  PurchaseRequestWithDetail,
} from '@/repositories/purchase-request.repository'
import { MaterialRepository } from '@/repositories/material.repository'
import { ItemPriceRepository } from '@/repositories/item-price.repository'

export type PurchaseRequestLineDto = {
  id: string
  materialId: string
  materialCode: string
  materialName: string
  unitAbbreviation: string
  quantity: string
  estimatedUnitCost: string | null
  lineTotal: string | null
  notes: string | null
}

export type PurchaseRequestDetailDto = {
  id: string
  prNumber: string
  status: PRStatus
  requestedById: string
  requesterName: string
  notes: string | null
  neededBy: string | null
  createdAt: string
  updatedAt: string
  lines: PurchaseRequestLineDto[]
  /** Null if ANY line is unpriced — a partial total would mislead the approver. */
  estimatedTotal: string | null
}

export type PurchaseRequestSummaryDto = {
  id: string
  prNumber: string
  status: PRStatus
  requesterName: string
  lineCount: number
  estimatedTotal: string | null
  neededBy: string | null
  createdAt: string
}

export type CreatePurchaseRequestServiceInput = {
  requestedById: string
  notes?: string | null
  neededBy?: string | null
  items: {
    materialId: string
    quantity: string
    estimatedUnitCost?: string | null
    notes?: string | null
  }[]
}

export type PurchaseRequestResult<T> =
  | { success: true;  data: T }
  | { success: false; error: string; status: number }

  /**
 * Sums estimatedUnitCost × quantity across the lines.
 *
 * Returns null if ANY line is unpriced. A partial total understates the request
 * and would mislead an approver into authorising more spend than the number on
 * screen. Same rule BomService applies to its totalCost.
 */
function sumLines(
  lines: { quantity: Prisma.Decimal; estimatedUnitCost: Prisma.Decimal | null }[],
): Prisma.Decimal | null {
  let total = new Prisma.Decimal(0)

  for (const line of lines) {
    if (line.estimatedUnitCost === null) return null
    total = total.add(line.estimatedUnitCost.mul(line.quantity))
  }

  return total
}

/**
 * Converts one repository row into the shape that leaves this layer.
 *
 * Every Decimal becomes a string and every Date an ISO string here, in one
 * place — see lib/decimal.ts for why a Decimal must never reach a Client
 * Component.
 */
function toDetailDto(pr: PurchaseRequestWithDetail): PurchaseRequestDetailDto {
  const total = sumLines(pr.items)

  return {
    id:            pr.id,
    prNumber:      pr.prNumber,
    status:        pr.status,
    requestedById: pr.requestedById,
    requesterName: pr.requester.name,
    notes:         pr.notes,
    neededBy:      pr.neededBy?.toISOString() ?? null,
    createdAt:     pr.createdAt.toISOString(),
    updatedAt:     pr.updatedAt.toISOString(),
    lines: pr.items.map(item => ({
      id:                item.id,
      materialId:        item.materialId,
      materialCode:      item.material.code,
      materialName:      item.material.name,
      unitAbbreviation:  item.material.unit.abbreviation,
      quantity:          toDecimalString(item.quantity),
      estimatedUnitCost: toNullableDecimalString(item.estimatedUnitCost),
      lineTotal:         item.estimatedUnitCost === null
        ? null
        : toDecimalString(item.estimatedUnitCost.mul(item.quantity)),
      notes:             item.notes,
    })),
    estimatedTotal: total === null ? null : toDecimalString(total),
  }
}

export const PurchaseRequestService = {
  async list(filters: PurchaseRequestListFilters = {}) {
    const { rows, total } = await PurchaseRequestRepository.findMany(filters)

    return {
      purchaseRequests: rows.map<PurchaseRequestSummaryDto>(pr => {
        const estimated = sumLines(pr.items)

        return {
          id:             pr.id,
          prNumber:       pr.prNumber,
          status:         pr.status,
          requesterName:  pr.requester.name,
          lineCount:      pr.items.length,
          estimatedTotal: estimated === null ? null : toDecimalString(estimated),
          neededBy:       pr.neededBy?.toISOString() ?? null,
          createdAt:      pr.createdAt.toISOString(),
        }
      }),
      total,
    }
  },

  async getById(id: string): Promise<PurchaseRequestResult<PurchaseRequestDetailDto>> {
    const pr = await PurchaseRequestRepository.findById(id)

    if (!pr) {
      return { success: false, error: 'Purchase request not found', status: 404 }
    }

    return { success: true, data: toDetailDto(pr) }
  },

  /**
   * Creates a DRAFT purchase request owned by the requester.
   *
   * requestedById comes from the caller, which takes it from the x-user-id
   * header middleware injected — never from the request body, or anyone could
   * raise a request in someone else's name.
   */
  async create(
    input: CreatePurchaseRequestServiceInput,
  ): Promise<PurchaseRequestResult<PurchaseRequestDetailDto>> {
    if (input.items.length === 0) {
      return { success: false, error: 'A purchase request needs at least one line', status: 400 }
    }

    const materialIds = input.items.map(item => item.materialId)

    if (new Set(materialIds).size !== materialIds.length) {
      return { success: false, error: 'The same material appears on more than one line', status: 400 }
    }

    // Every referenced material fetched in ONE query, then validated in memory.
    // Calling findById per line would be an N+1 that grows with request size.
    const materials = await MaterialRepository.findManyByIds(materialIds)

    for (const item of input.items) {
      const material = materials.get(item.materialId)

      if (!material) {
        return { success: false, error: `Material ${item.materialId} not found`, status: 400 }
      }
      if (toDecimal(item.quantity).lessThanOrEqualTo(0)) {
        return {
          success: false,
          error:   `Quantity for ${material.name} must be greater than zero`,
          status:  400,
        }
      }
    }

    // Week 2 pays off here: one supplier-aware query prices every line, with
    // reference-price fallback. A PR has no supplier yet, so this resolves to
    // the organisation reference price.
    const prices = await ItemPriceRepository.findPricesAsOf(materialIds, new Date())

    const pr = await PurchaseRequestRepository.create({
      requestedById: input.requestedById,
      notes:         input.notes ?? null,
      neededBy:      input.neededBy ? new Date(input.neededBy) : null,
      items: input.items.map(item => ({
        materialId: item.materialId,
        quantity:   toDecimal(item.quantity),
        // A cost the caller typed wins; otherwise fall back to the reference
        // price so the approver always sees a costed request. Null only when
        // the material has no price on record at all.
        estimatedUnitCost: item.estimatedUnitCost != null
          ? toDecimal(item.estimatedUnitCost)
          : (prices.get(item.materialId)?.unitPrice ?? null),
        notes: item.notes ?? null,
      })),
    })

    return { success: true, data: toDetailDto(pr) }
  },
}


