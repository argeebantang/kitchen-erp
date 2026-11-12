import { ConversionStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { InventoryRepository } from '@/repositories/inventory.repository'
import { FinishedGoodStockRepository, planFefoTakes } from '@/repositories/finished-good-stock.repository'

export type CreateConversionOrderInput = {
  /** The active CONVERSION version, pinned. */
  bomId: string
  finishedGoodId: string
  sourceFinishedGoodId: string
  branchId: string
  submittedById: string
  sourceQty: Prisma.Decimal
  outputQty: Prisma.Decimal
  notes: string | null
}

/** What approving writes (Week 7 Task 1, D6–D8), worked out by the service before the transaction. */
export type ConversionApproval = {
  orderNumber: string
  branchId: string
  sourceFinishedGoodId: string
  sourceQty: Prisma.Decimal
  /** For the message when the source is short: "12.5 kg … Lechon". */
  sourceLabel: { name: string; unitAbbreviation: string }
  /** One per material; unitCost = the reference price on the conversion date (D7). */
  ingredients: { materialId: string; quantity: Prisma.Decimal; unitCost: Prisma.Decimal }[]
  /** Σ ingredients' quantity × unitCost. */
  conversionCost: Prisma.Decimal
  output: { finishedGoodId: string; quantity: Prisma.Decimal; producedOn: Date; expiresAt: Date }
  /** The clock expired lots are judged by. */
  now: Date
}

export type ConversionDecideResult =
  | { ok: true }
  | { ok: false; reason: 'not-pending' }
  | { ok: false; reason: 'source'; message: string }

/** Aborts an approval from inside its transaction, rolling everything back. */
class ConversionConflict extends Error {}

export type ConversionOrderListFilters = {
  status?: ConversionStatus
  skip?: number
  take?: number
}

/**
 * Everything a list row and the detail page show, in one query: both goods
 * with their units, the pinned recipe's header (its batch and source
 * quantity give the expected output), the branch and who recorded it.
 */
const conversionInclude = {
  // shelfLifeHours: the output lot expires that long after the conversion (D8).
  finishedGood:       { select: { id: true, code: true, name: true, shelfLifeHours: true, unit: { select: { abbreviation: true } } } },
  sourceFinishedGood: { select: { id: true, code: true, name: true, unit: { select: { abbreviation: true } } } },
  bom:                { select: { id: true, version: true, isActive: true, batchSize: true, sourceQuantity: true } },
  branch:             { select: { id: true, name: true } },
  submittedBy:        { select: { id: true, name: true } },
} as const

export type ConversionOrderWithDetail = Prisma.ConversionOrderGetPayload<{ include: typeof conversionInclude }>

export const ConversionOrderRepository = {
  /**
   * Inserts an order numbered CNV-000001 from cnv_number_seq, already
   * PENDING_APPROVAL: it records a conversion that has happened, so there is
   * no draft (Week 7 Task 1, D4). nextval() runs inside the same transaction
   * as the insert, like every other document number.
   */
  async create(input: CreateConversionOrderInput): Promise<{ id: string; orderNumber: string }> {
    return prisma.$transaction(async tx => {
      const [row] = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('cnv_number_seq')`
      const orderNumber = `CNV-${row.nextval.toString().padStart(6, '0')}`

      return tx.conversionOrder.create({
        data:   { ...input, orderNumber, status: ConversionStatus.PENDING_APPROVAL },
        select: { id: true, orderNumber: true },
      })
    })
  },

  /** CNV numbers for the Stock Ledger's source column: one query per page. */
  async numbersByIds(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map()
    const rows = await prisma.conversionOrder.findMany({ where: { id: { in: ids } }, select: { id: true, orderNumber: true } })
    return new Map(rows.map(row => [row.id, row.orderNumber]))
  },

  async findById(id: string): Promise<ConversionOrderWithDetail | null> {
    return prisma.conversionOrder.findUnique({ where: { id }, include: conversionInclude })
  },

  /** Newest first, paged, optionally one status. */
  async findMany(filters: ConversionOrderListFilters = {}) {
    const where: Prisma.ConversionOrderWhereInput = {}
    if (filters.status) where.status = filters.status

    const [rows, total] = await prisma.$transaction([
      prisma.conversionOrder.findMany({
        where,
        include: conversionInclude,
        orderBy: { createdAt: 'desc' },
        skip:    filters.skip ?? 0,
        take:    filters.take ?? 50,
      }),
      prisma.conversionOrder.count({ where }),
    ])

    return { rows, total }
  },

  /**
   * Accounting's decision, in one transaction (Week 7 Task 1, D6). The status
   * moves first, with PENDING_APPROVAL in the WHERE (0 rows → someone decided
   * it first, nothing written), then the Approval row. Rejecting stops there.
   *
   * Approving then, on the same transaction:
   *  1. locks the source good's lot levels at the branch and re-plans from
   *     what they hold now — soonest expiry first, expired lots skipped —
   *     because lots may have expired or been used since it was submitted;
   *     short → rolled back, 'source';
   *  2. takes the source out of those lots, each at its recorded cost per
   *     unit, which together are the source cost (D7);
   *  3. takes the added ingredients out of material stock, in materialId
   *     order like production (they may go negative);
   *  4. puts the output in as a new lot numbered after the order (D8), at
   *     (source cost + conversion cost) ÷ output per unit;
   *  5. records the three costs on the order, never recomputed.
   */
  async decide(input: {
    id: string
    approverId: string
    remarks: string | null
    decision: { kind: 'REJECTED' } | { kind: 'APPROVED'; approval: ConversionApproval }
  }): Promise<ConversionDecideResult> {
    try {
      return await prisma.$transaction(async tx => {
        const approving = input.decision.kind === 'APPROVED'
        const { count } = await tx.conversionOrder.updateMany({
          where: { id: input.id, status: ConversionStatus.PENDING_APPROVAL },
          data:  { status: approving ? ConversionStatus.APPROVED : ConversionStatus.REJECTED },
        })
        if (count === 0) return { ok: false as const, reason: 'not-pending' as const }

        await tx.approval.create({
          data: {
            referenceType: 'ConversionOrder',
            referenceId:   input.id,
            approverId:    input.approverId,
            decision:      input.decision.kind,
            remarks:       input.remarks,
          },
        })

        if (input.decision.kind === 'REJECTED') return { ok: true as const }
        const approval = input.decision.approval
        const reference = { referenceType: 'ConversionOrder', referenceId: input.id, notes: approval.orderNumber }

        // 1. The source, re-planned under lock.
        await FinishedGoodStockRepository.lockLots(tx, approval.sourceFinishedGoodId, approval.branchId)
        const lots = await FinishedGoodStockRepository.lotsOnHand(approval.sourceFinishedGoodId, approval.branchId, tx)
        const plan = planFefoTakes(lots, approval.sourceQty, approval.now)
        if (plan.short.greaterThan(0)) {
          const { name, unitAbbreviation: unit } = approval.sourceLabel
          const available = approval.sourceQty.sub(plan.short)
          throw new ConversionConflict(`Only ${available.toString()} ${unit} of the ${approval.sourceQty.toString()} ${unit} ${name} needed is still on hand and unexpired at the branch — lots expired or were used since this was submitted. Reject it, and production records what can still be converted`)
        }

        // 2. Out of the lots, at their recorded cost.
        let sourceCost = new Prisma.Decimal(0)
        for (const take of plan.takes) {
          const unitCost = take.lot.movements[0]?.unitCost ?? null
          if (unitCost === null) {
            throw new ConversionConflict(`Lot ${take.lot.lotNumber} has no recorded cost, so the conversion cannot be costed`)
          }
          sourceCost = sourceCost.add(take.quantity.mul(unitCost))
          await FinishedGoodStockRepository.takeFromLot(tx, {
            lotId: take.lot.id, branchId: approval.branchId, quantity: take.quantity, unitCost, ...reference,
          })
        }

        // 3. The added ingredients, in a fixed order.
        const byMaterial = [...approval.ingredients].sort((a, b) => (a.materialId < b.materialId ? -1 : 1))
        for (const line of byMaterial) {
          if (line.quantity.lessThanOrEqualTo(0)) continue
          await InventoryRepository.stockOut(tx, { materialId: line.materialId, branchId: approval.branchId, quantity: line.quantity, unitCost: line.unitCost, ...reference })
        }

        // 4. The output lot.
        const costPerUnit = sourceCost.add(approval.conversionCost).div(approval.output.quantity)
        await FinishedGoodStockRepository.receiveLot(tx, {
          lotNumber:         approval.orderNumber,
          finishedGoodId:    approval.output.finishedGoodId,
          conversionOrderId: input.id,
          producedOn:        approval.output.producedOn,
          expiresAt:         approval.output.expiresAt,
          branchId:          approval.branchId,
          quantity:          approval.output.quantity,
          unitCost:          costPerUnit,
          ...reference,
        })

        // 5. The costs, with the decision.
        await tx.conversionOrder.update({
          where: { id: input.id },
          data:  { sourceCost, conversionCost: approval.conversionCost, costPerUnit },
        })
        return { ok: true as const }
      })
    } catch (err) {
      // Thrown inside the callback so Prisma rolls the whole transaction back.
      if (err instanceof ConversionConflict) return { ok: false, reason: 'source', message: err.message }
      throw err
    }
  },

  /** Pending conversions, oldest first — the approvals inbox. Bounded by `take`. */
  async findPending(take: number): Promise<ConversionOrderWithDetail[]> {
    return prisma.conversionOrder.findMany({
      where:   { status: ConversionStatus.PENDING_APPROVAL },
      include: conversionInclude,
      orderBy: { createdAt: 'asc' },
      take,
    })
  },

  /**
   * How much of a source good other conversions at the branch have claimed
   * but not yet taken: their source leaves the lots only on approval, so until
   * then it is spoken for — the conversion counterpart of production's
   * committed stock. Served by @@index([status]).
   */
  async pendingSourceAtBranch(
    sourceFinishedGoodId: string,
    branchId: string,
    excludeId: string | null,
  ): Promise<Prisma.Decimal> {
    const { _sum } = await prisma.conversionOrder.aggregate({
      where: {
        status: ConversionStatus.PENDING_APPROVAL,
        sourceFinishedGoodId,
        branchId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      _sum: { sourceQty: true },
    })
    return _sum.sourceQty ?? new Prisma.Decimal(0)
  },
}
