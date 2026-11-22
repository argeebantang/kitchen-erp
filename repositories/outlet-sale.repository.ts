import { MovementType, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { FinishedGoodStockRepository, planFefoTakes } from '@/repositories/finished-good-stock.repository'

/** Something changed under the form: not enough left, or the day already recorded. Nothing is written. */
export class OutletSaleConflict extends Error {}

export type CreateOutletSaleInput = {
  branchId: string
  branchName: string
  soldOn: Date
  submittedById: string
  notes: string | null
  lines: {
    finishedGoodId: string
    name: string
    unitAbbreviation: string
    quantity: Prisma.Decimal
    unitPrice: Prisma.Decimal
  }[]
}

const listSelect = {
  id: true, saleNumber: true, soldOn: true, totalAmount: true, totalCost: true, createdAt: true,
  branch:      { select: { id: true, name: true, code: true } },
  submittedBy: { select: { name: true } },
  _count:      { select: { items: true } },
} satisfies Prisma.OutletSaleSelect

const detailSelect = {
  ...listSelect,
  notes: true,
  items: {
    select: {
      id: true, quantity: true, unitPrice: true, amount: true,
      finishedGood: { select: { id: true, code: true, name: true, unit: { select: { abbreviation: true } } } },
    },
    orderBy: { finishedGood: { name: 'asc' } },
  },
} satisfies Prisma.OutletSaleSelect

export type OutletSaleSummary = Prisma.OutletSaleGetPayload<{ select: typeof listSelect }>
export type OutletSaleDetail  = Prisma.OutletSaleGetPayload<{ select: typeof detailSelect }>

export const OutletSaleRepository = {
  /**
   * Records a day's sales and takes the goods out of the outlet, in one
   * transaction (Week 10 Task 1): SLS-000001 from sls_number_seq; per good,
   * its lots locked and taken soonest expiry first, never an expired lot —
   * the delivery and return rule (planFefoTakes). Any good short → nothing is
   * written and every short good is named. The day already recorded (the
   * unique outlet + day) → the same conflict, nothing written.
   *
   * totalCost is what the lots taken were recorded at, fixed now.
   */
  async create(input: CreateOutletSaleInput): Promise<{ id: string; saleNumber: string }> {
    try {
      return await prisma.$transaction(async tx => {
        const now   = new Date()
        // In a fixed order, so two saves at once cannot deadlock on each other's lots.
        const lines = [...input.lines].sort((a, b) => a.finishedGoodId.localeCompare(b.finishedGoodId))
        const plans = []
        const shortfalls: string[] = []
        for (const line of lines) {
          await FinishedGoodStockRepository.lockLots(tx, line.finishedGoodId, input.branchId)
          const lots = await FinishedGoodStockRepository.lotsOnHand(line.finishedGoodId, input.branchId, tx)
          const plan = planFefoTakes(lots, line.quantity, now)
          if (plan.short.greaterThan(0)) {
            shortfalls.push(`${line.name} — ${line.quantity.toString()} ${line.unitAbbreviation} sold, ${line.quantity.sub(plan.short).toString()} ${line.unitAbbreviation} unexpired on hand`)
          }
          plans.push(plan)
        }
        if (shortfalls.length > 0) {
          throw new OutletSaleConflict(`${input.branchName} does not have that much on its books: ${shortfalls.join('; ')}. Check that every delivery has been received.`)
        }

        const zero = new Prisma.Decimal(0)
        const totalCost = plans
          .flatMap(plan => plan.takes)
          .reduce((sum, take) => sum.add(take.quantity.mul(take.lot.movements[0]?.unitCost ?? zero)), zero)
        const items = input.lines.map(line => ({
          finishedGoodId: line.finishedGoodId,
          quantity:       line.quantity,
          unitPrice:      line.unitPrice,
          amount:         line.quantity.mul(line.unitPrice),
        }))

        const [row] = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('sls_number_seq')`
        const saleNumber = `SLS-${row.nextval.toString().padStart(6, '0')}`
        const sale = await tx.outletSale.create({
          data: {
            saleNumber,
            branchId:      input.branchId,
            soldOn:        input.soldOn,
            submittedById: input.submittedById,
            notes:         input.notes,
            totalAmount:   items.reduce((sum, item) => sum.add(item.amount), zero),
            totalCost,
            items:         { create: items },
          },
          select: { id: true, saleNumber: true },
        })

        for (const plan of plans) {
          for (const take of plan.takes) {
            await FinishedGoodStockRepository.takeFromLot(tx, {
              lotId:         take.lot.id,
              branchId:      input.branchId,
              quantity:      take.quantity,
              unitCost:      take.lot.movements[0]?.unitCost ?? null,
              type:          MovementType.OUT,
              referenceType: 'OutletSale',
              referenceId:   sale.id,
              notes:         saleNumber,
            })
          }
        }
        return sale
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new OutletSaleConflict(`${input.branchName}'s sales for that day are already recorded`)
      }
      throw err
    }
  },

  /** SLS numbers by id — the End of Day page's document list. */
  async numbersByIds(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map()
    const rows = await prisma.outletSale.findMany({ where: { id: { in: ids } }, select: { id: true, saleNumber: true } })
    return new Map(rows.map(row => [row.id, row.saleNumber]))
  },

  /** Newest day first; `branchId` null = every outlet. */
  async findMany(input: { branchId: string | null; skip: number; take: number }): Promise<{ rows: OutletSaleSummary[]; total: number }> {
    const where: Prisma.OutletSaleWhereInput = input.branchId ? { branchId: input.branchId } : {}
    const [rows, total] = await prisma.$transaction([
      prisma.outletSale.findMany({
        where, select: listSelect, skip: input.skip, take: input.take,
        orderBy: [{ soldOn: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.outletSale.count({ where }),
    ])
    return { rows, total }
  },

  async findById(id: string): Promise<OutletSaleDetail | null> {
    return prisma.outletSale.findUnique({ where: { id }, select: detailSelect })
  },

  /** The days an outlet has already recorded among `days` — the form greys them out. */
  async recordedDays(branchIds: string[], days: Date[]): Promise<{ branchId: string; soldOn: Date }[]> {
    if (branchIds.length === 0) return []
    return prisma.outletSale.findMany({
      where:  { branchId: { in: branchIds }, soldOn: { in: days } },
      select: { branchId: true, soldOn: true },
    })
  },

  /** The lots each line was taken from: the sale's ledger rows. */
  async lotsTaken(id: string): Promise<{ finishedGoodId: string; lotNumber: string; expiresAt: Date | null; quantity: Prisma.Decimal; unitCost: Prisma.Decimal | null }[]> {
    const rows = await prisma.finishedGoodMovement.findMany({
      where:   { referenceType: 'OutletSale', referenceId: id },
      select:  { quantity: true, unitCost: true, lot: { select: { finishedGoodId: true, lotNumber: true, expiresAt: true } } },
      orderBy: { lot: { expiresAt: 'asc' } },
    })
    return rows.map(row => ({
      finishedGoodId: row.lot.finishedGoodId, lotNumber: row.lot.lotNumber, expiresAt: row.lot.expiresAt,
      quantity: row.quantity.negated(), unitCost: row.unitCost,
    }))
  },
}
