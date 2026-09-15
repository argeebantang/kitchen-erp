import { Prisma, POStatus } from '@prisma/client'

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
}
