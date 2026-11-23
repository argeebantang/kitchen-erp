import { Prisma, PRStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  PurchaseOrderRepository,
  type PurchaseOrderLineInput,
} from '@/repositories/purchase-order.repository'

export type PurchaseRequestLineInput = {
  materialId: string
  quantity: Prisma.Decimal
  estimatedUnitCost?: Prisma.Decimal | null
  notes?: string | null
}

export type CreatePurchaseRequestInput = {
  requestedById: string
  /** The kitchen it is for (Week 10 Task 4). */
  deliverToId: string
  notes?: string | null
  neededBy?: Date | null
  items: PurchaseRequestLineInput[]
}

/**
 * How a list is ordered.
 *
 * A named option rather than exposing Prisma's orderBy shape: the repository
 * owns how sorting is expressed in SQL, so services and pages never import
 * Prisma types just to ask for an order.
 */
export type PurchaseRequestSort = 'newest' | 'neededBy'

export type PurchaseRequestListFilters = {
  status?: PRStatus
  requestedById?: string
  skip?: number
  take?: number
  sort?: PurchaseRequestSort
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
  deliverTo: { select: { id: true, name: true } },
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
  purchaseOrders: {
    select:  { id: true, poNumber: true, status: true },
    orderBy: { createdAt: 'asc' },
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
  deliverTo: { select: { name: true } },
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

    // 'neededBy' is the approval queue's order — deal with what is wanted
    // soonest, first. A request with no date must not jump the queue, hence
    // nulls: 'last'. Postgres already defaults that way for ASC, but stating it
    // keeps the intent correct if the direction ever flips. createdAt breaks
    // ties, so two requests needed the same day are handled oldest-first.
    const orderBy: Prisma.PurchaseRequestOrderByWithRelationInput[] =
      filters.sort === 'neededBy'
        ? [{ neededBy: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }]
        : [{ createdAt: 'desc' }]

    const [rows, total] = await prisma.$transaction([
      prisma.purchaseRequest.findMany({
        where,
        include: summaryInclude,
        orderBy,
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
   * DRAFT → PENDING_APPROVAL, stamping submittedAt (Week 11 Task 1). The
   * status sits in the WHERE, so a double-click or a second tab submits once;
   * null when the request stopped being a draft first (docs/coding-conventions.md,
   * Concurrency).
   */
  async submit(id: string): Promise<PurchaseRequestWithDetail | null> {
    const { count } = await prisma.purchaseRequest.updateMany({
      where: { id, status: PRStatus.DRAFT },
      data:  { status: PRStatus.PENDING_APPROVAL, submittedAt: new Date() },
    })
    if (count === 0) return null
    return prisma.purchaseRequest.findUnique({ where: { id }, include: detailInclude })
  },

  /**
   * Records a decision and moves the request, as ONE transaction.
   *
   * Both writes must land together. If the Approval insert succeeded and the
   * status update did not, the request would sit at PENDING_APPROVAL with a
   * decision already logged — and the approver would be asked to decide it
   * again. If the status update landed without the Approval row, the request
   * would read APPROVED with no record of who authorised the spend, which is
   * exactly the question an audit asks.
   *
   * $transaction gives all-or-nothing: if anything inside throws, Postgres
   * rolls both writes back and no half-finished state is ever visible.
   */
  async applyDecision(input: {
    id: string
    newStatus: PRStatus
    approverId: string
    decision: string
    remarks?: string | null
    purchaseOrderLines?: PurchaseOrderLineInput[]
    /** Copied onto the purchase order it becomes. */
    deliverToId?: string | null
  }): Promise<PurchaseRequestWithDetail | null> {
    return prisma.$transaction(async tx => {
      // NOTE: tx, not prisma. Inside this callback `tx` is the transactional
      // client; writing `prisma.` here instead would run that statement OUTSIDE
      // the transaction, silently defeating the whole thing.

      // The status moves FIRST, with PENDING_APPROVAL in the WHERE (Week 11
      // Task 1). Two approvers clicking at once in the inbox used to both pass
      // the service's read-then-check and both create a purchase order; now
      // the second matches no row, writes nothing, and gets null (409).
      const { count } = await tx.purchaseRequest.updateMany({
        where: { id: input.id, status: PRStatus.PENDING_APPROVAL },
        data:  { status: input.newStatus },
      })
      if (count === 0) return null

      await tx.approval.create({
        data: {
          referenceType: 'PurchaseRequest',
          referenceId:   input.id,
          approverId:    input.approverId,
          decision:      input.decision,
          remarks:       input.remarks ?? null,
        },
      })

      // Joins the SAME transaction because tx is passed through. Creating it
      // with `prisma` instead would leave an orphan purchase order behind when
      // the approval rolls back.
      if (input.purchaseOrderLines) {
        await PurchaseOrderRepository.createDraftFromRequest(tx, {
          purchaseRequestId: input.id,
          deliverToId:       input.deliverToId ?? null,
          lines:             input.purchaseOrderLines,
        })
      }

      return tx.purchaseRequest.findUnique({ where: { id: input.id }, include: detailInclude })
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
        deliverToId:   input.deliverToId,
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
