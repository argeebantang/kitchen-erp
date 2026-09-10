import { Prisma, PRStatus, Role } from '@prisma/client'
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

/**
 * Who is asking. Taken from the verified JWT — getSession() in a Server
 * Component, or the x-user-id / x-user-role headers middleware injects in a
 * route handler. Never from a request body.
 *
 * role is a plain string because that is what JWTPayload carries; the constant
 * below is typed as Role[] so the literals themselves are still checked.
 */
export type Viewer = {
  userId: string
  role: string
}

/**
 * Roles that see every request. Everyone else sees only their own.
 *
 * This is scoping, not secrecy: a branch manager's list stays useful instead of
 * filling with other people's requests. Accounting and procurement need the
 * whole picture to approve and to source.
 */
const ROLES_SEEING_ALL_REQUESTS: Role[] = ['ADMIN', 'ACCOUNTING', 'PROCUREMENT_MANAGER']

function seesAllRequests(viewer: Viewer): boolean {
  return ROLES_SEEING_ALL_REQUESTS.some(role => role === viewer.role)
}

export const PurchaseRequestService = {
  /**
   * Scoping is applied here rather than by the caller. A page or handler that
   * forgot to pass requestedById would silently leak every request, so the
   * decision cannot live at the call site.
   */
  async list(viewer: Viewer, filters: PurchaseRequestListFilters = {}) {
    const scoped: PurchaseRequestListFilters = seesAllRequests(viewer)
      ? filters
      : { ...filters, requestedById: viewer.userId }

    const { rows, total } = await PurchaseRequestRepository.findMany(scoped)

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

  async getById(
    id: string,
    viewer: Viewer,
  ): Promise<PurchaseRequestResult<PurchaseRequestDetailDto>> {
    const pr = await PurchaseRequestRepository.findById(id)

    // 404 rather than 403 when a requester opens someone else's PR: a 403 would
    // confirm the id exists, which is more than they are entitled to know.
    if (!pr || (!seesAllRequests(viewer) && pr.requestedById !== viewer.userId)) {
      return { success: false, error: 'Purchase request not found', status: 404 }
    }

    return { success: true, data: toDetailDto(pr) }
  },
  
   /**
   * DRAFT → PENDING_APPROVAL.
   *
   * The ownership check is repeated here even though getById already scopes
   * reads, because this endpoint can be called directly with curl — the user
   * need never have loaded the page.
   */
  async submit(
    id: string,
    viewer: Viewer,
  ): Promise<PurchaseRequestResult<PurchaseRequestDetailDto>> {
    const pr = await PurchaseRequestRepository.findById(id)

    // Same 404-not-403 reasoning as getById: do not confirm an id exists to
    // someone with no business knowing.
    if (!pr || (!seesAllRequests(viewer) && pr.requestedById !== viewer.userId)) {
      return { success: false, error: 'Purchase request not found', status: 404 }
    }

    // Accounting can SEE every request but must not submit one — they approve,
    // and submitting on someone's behalf blurs whose request it is. ADMIN may
    // act for anyone.
    if (pr.requestedById !== viewer.userId && viewer.role !== Role.ADMIN) {
      return { success: false, error: 'Only the requester can submit this request', status: 403 }
    }

    if (pr.status !== PRStatus.DRAFT) {
      return {
        success: false,
        error:   `This request is already ${pr.status.replace(/_/g, ' ').toLowerCase()} and cannot be submitted again`,
        status:  409,
      }
    }

    if (pr.items.length === 0) {
      return { success: false, error: 'Add at least one line before submitting', status: 400 }
    }

    const updated = await PurchaseRequestRepository.updateStatus(id, PRStatus.PENDING_APPROVAL)

    return { success: true, data: toDetailDto(updated) }
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


