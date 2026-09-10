import { Prisma, PRStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export type PurchaseRequestLineInput = {
  materialId: string
  quantity: Prisma.Decimal
  estimatedUnitCost?: Prisma.Decimal | null
  notes?: string | null
}

export type CreatePurchaseRequestInput = {
  requestedById: string
  notes?: string | null
  neededBy?: Date | null
  items: PurchaseRequestLineInput[]
}

export type PurchaseRequestListFilters = {
  status?: PRStatus
  requestedById?: string
  skip?: number
  take?: number
}

/**
 * A PR is never shown without its lines, and a line is meaningless without the
 * material it names — so the tree is fetched in one query rather than looping
 * lines to resolve materials (the N+1 docs/coding-conventions.md warns about).
 *
 * The unit comes from the material, not the line: PurchaseRequestItem has no
 * unitId because there is still no unit-conversion layer, so a line is always
 * quantified in its material's stocking unit. Same rule BomService enforces.
 */
const detailInclude = {
  requester: { select: { id: true, name: true, email: true, role: true } },
  items: {
    include: {
      material: {
        select: {
          id: true, code: true, name: true,
          unit: { select: { id: true, abbreviation: true } },
        },
      },
    },
    orderBy: { material: { name: 'asc' } },
  },
} satisfies Prisma.PurchaseRequestInclude


export type PurchaseRequestWithDetail = Prisma.PurchaseRequestGetPayload<{
  include: typeof detailInclude
}>

/**
 * List rows carry their lines' quantity and cost so the service can total each
 * PR without a second round trip per row. Prisma resolves an include like this
 * as ONE extra query for all rows, not one per row — so a 50-row inbox is 3
 * queries (rows, items, count), not 51.
 */
const summaryInclude = {
  requester: { select: { id: true, name: true } },
  items:     { select: { quantity: true, estimatedUnitCost: true } },
} satisfies Prisma.PurchaseRequestInclude

export type PurchaseRequestSummary = Prisma.PurchaseRequestGetPayload<{
  include: typeof summaryInclude
}>

/**
 * The next document number, e.g. "PR-000001".
 *
 * nextval() is atomic — two simultaneous submits receive two different numbers.
 * The obvious alternative, count() + 1, reads the same value in both requests
 * and issues the same number twice; that race is invisible in development and
 * then collides with the @unique on prNumber under real concurrent use.
 *
 * Sequences do not roll back, so an aborted transaction burns a number and the
 * series can contain gaps. That is intended: document numbers must be unique,
 * not contiguous.
 *
 * Raw SQL because pr_number_seq is a standalone sequence — Prisma's schema
 * language cannot declare one, so it lives in the Week 3 migration instead.
 */
async function nextPrNumber(): Promise<string> {
  const [row] = await prisma.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('pr_number_seq')`
  return `PR-${row.nextval.toString().padStart(6, '0')}`
}

function buildWhere(filters: PurchaseRequestListFilters): Prisma.PurchaseRequestWhereInput {
  const where: Prisma.PurchaseRequestWhereInput = {}

  if (filters.status) {
    where.status = filters.status
  }
  if (filters.requestedById) {
    where.requestedById = filters.requestedById
  }

  return where
}

export const PurchaseRequestRepository = {
  nextPrNumber,

  /**
   * Newest first — every consumer of this list (the requester's own list, the
   * approver's inbox) reads it as a queue. Paginated from the first query
   * rather than retrofitted, per docs/coding-conventions.md.
   */
  async findMany(filters: PurchaseRequestListFilters = {}) {
    const where = buildWhere(filters)

    const [rows, total] = await prisma.$transaction([
      prisma.purchaseRequest.findMany({
        where,
        include: summaryInclude,
        orderBy: { createdAt: 'desc' },
        skip:    filters.skip ?? 0,
        take:    filters.take ?? 50,
      }),
      prisma.purchaseRequest.count({ where }),
    ])

    return { rows, total }
  },

  async findById(id: string): Promise<PurchaseRequestWithDetail | null> {
    return prisma.purchaseRequest.findUnique({ where: { id }, include: detailInclude })
  },
  

  /**
     * Moves a request to a new status.
     *
     * Deliberately dumb — which transitions are legal is a business rule, so that
     * decision lives in the service. Postgres would happily accept
     * DRAFT → CONVERTED_TO_PO; see docs/database.md: "status transitions are
     * enforced in the service layer, not by the database".
     */
    async updateStatus(id: string, status: PRStatus): Promise<PurchaseRequestWithDetail> {
      return prisma.purchaseRequest.update({
        where:   { id },
        data:    { status },
        include: detailInclude,
      })
    },

  /**
   * Creates a DRAFT with its lines in one statement — Prisma emits a single
   * transaction for the nested create, so a PR can never exist with a partial
   * set of lines.
   *
   * The number is assigned here, at creation, not at submission: a PR that
   * cannot be referred to by number is awkward in the UI and in the audit
   * trail, and abandoned drafts leaving gaps costs nothing.
   */
  async create(input: CreatePurchaseRequestInput): Promise<PurchaseRequestWithDetail> {
    const prNumber = await nextPrNumber()

    return prisma.purchaseRequest.create({
      data: {
        prNumber,
        requestedById: input.requestedById,
        status:        PRStatus.DRAFT,
        notes:         input.notes ?? null,
        neededBy:      input.neededBy ?? null,
        items: {
          create: input.items.map(item => ({
            materialId:        item.materialId,
            quantity:          item.quantity,
            estimatedUnitCost: item.estimatedUnitCost ?? null,
            notes:             item.notes ?? null,
          })),
        },
      },
      include: detailInclude,
    })
  },
}
