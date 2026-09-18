import { Prisma, POStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export type PurchaseOrderLineInput = {
  materialId: string
  quantity: Prisma.Decimal
  unitCost: Prisma.Decimal
}

export type CreateDraftFromRequestInput = {
  purchaseRequestId: string
  lines: PurchaseOrderLineInput[]
}

export const PurchaseOrderRepository = {
  

 async findMany(filters: PurchaseOrderListFilters = {}) {
    const where: Prisma.PurchaseOrderWhereInput = {}
    if (filters.status)     where.status     = filters.status
    if (filters.supplierId) where.supplierId = filters.supplierId

    const [rows, total] = await prisma.$transaction([
      prisma.purchaseOrder.findMany({
        where,
        include: summaryInclude,
        orderBy: { createdAt: 'desc' },
        skip:    filters.skip ?? 0,
        take:    filters.take ?? 50,
      }),
      prisma.purchaseOrder.count({ where }),
    ])

    return { rows, total }
  },

     async findById(id: string): Promise<PurchaseOrderWithDetail | null> {
    return prisma.purchaseOrder.findUnique({ where: { id }, include: detailInclude })
  },

  /**
   * Creates the DRAFT purchase order that an approved request turns into.
   *
   * Takes a transaction client instead of reaching for `prisma` itself, so the
   * caller can make this one part of a larger all-or-nothing operation.
   * Approving a request writes the Approval row, flips the request's status AND
   * creates this draft — a request marked CONVERTED_TO_PO with no purchase
   * order behind it is an unrepairable record.
   *
   * supplierId is left null on purpose. A request never names a supplier, and
   * choosing one is procurement's job — it depends on price, lead time, stock
   * and minimum order size. The service refuses to submit a PO for approval
   * while it is still null.
   */
  async createDraftFromRequest(
    tx: Prisma.TransactionClient,
    input: CreateDraftFromRequestInput,
  ) {
    // Same sequence trick as prNumber, run on the transaction client. Sequences
    // do not roll back, so an aborted approval burns a PO number — gaps are
    // fine, duplicates are not.
    const [row] = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('po_number_seq')`
    const poNumber = `PO-${row.nextval.toString().padStart(6, '0')}`

    // Totalled in Decimal, never in JS numbers — see lib/decimal.ts.
    const totalAmount = input.lines.reduce(
      (sum, line) => sum.add(line.unitCost.mul(line.quantity)),
      new Prisma.Decimal(0),
    )

    return tx.purchaseOrder.create({
      data: {
        poNumber,
        purchaseRequestId: input.purchaseRequestId,
        supplierId:        null,
        status:            POStatus.DRAFT,
        totalAmount,
        items: {
          create: input.lines.map(line => ({
            materialId: line.materialId,
            quantity:   line.quantity,
            unitCost:   line.unitCost,
            totalCost:  line.unitCost.mul(line.quantity),
          })),
        },
      },
    })
  },


  async updateDraft(input: {
    id: string
    supplierId: string | null
    expectedDelivery: Date | null
    notes: string | null
    totalAmount: Prisma.Decimal
    lines: { id: string; unitCost: Prisma.Decimal; totalCost: Prisma.Decimal }[]
  }): Promise<PurchaseOrderWithDetail> {
    return prisma.$transaction(async tx => {
      // A loop because each line takes a different value and Prisma has no
      // "update many rows to different values" call. Bounded by the lines on one
      // order — a handful — and inside a single transaction, so this is not the
      // unbounded N+1 docs/coding-conventions.md warns about.
      for (const line of input.lines) {
        await tx.purchaseOrderItem.update({
          where: { id: line.id },
          data:  { unitCost: line.unitCost, totalCost: line.totalCost },
        })
      }

      return tx.purchaseOrder.update({
        where: { id: input.id },
        data: {
          supplierId:       input.supplierId,
          expectedDelivery: input.expectedDelivery,
          notes:            input.notes,
          totalAmount:      input.totalAmount,
        },
        include: detailInclude,
      })
    })
  },

}

/**
 * A purchase order is never shown without its lines, its supplier, or the
 * request it came from — so one query fetches all of it.
 */
const detailInclude = {
  supplier:        { select: { id: true, name: true, email: true, phone: true, address: true } },
  purchaseRequest: { select: { id: true, prNumber: true } },
  items: {
    include: {
      material: {
        select: {
          id: true, code: true, name: true,
          unit: { select: { abbreviation: true } },
        },
      },
    },
    orderBy: { material: { name: 'asc' } },
  },
} satisfies Prisma.PurchaseOrderInclude

export type PurchaseOrderWithDetail = Prisma.PurchaseOrderGetPayload<{
  include: typeof detailInclude
}>

/**
 * List rows need only a count, not the lines themselves — totalAmount is stored
 * on the order, so unlike a purchase request there is nothing to sum per row.
 */
const summaryInclude = {
  supplier:        { select: { id: true, name: true } },
  purchaseRequest: { select: { id: true, prNumber: true } },
  _count:          { select: { items: true } },
} satisfies Prisma.PurchaseOrderInclude

export type PurchaseOrderSummary = Prisma.PurchaseOrderGetPayload<{
  include: typeof summaryInclude
}>

export type PurchaseOrderListFilters = {
  status?: POStatus
  supplierId?: string
  skip?: number
  take?: number
}







