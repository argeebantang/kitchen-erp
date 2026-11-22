import { BranchType, Prisma } from '@prisma/client'
import { toDecimal, toDecimalString } from '@/lib/decimal'
import { addDays, todayIsoDate } from '@/lib/dates'
import { trimDecimal } from '@/lib/format'
import { signalInventoryChanged } from '@/lib/realtime'
import { BranchRepository } from '@/repositories/branch.repository'
import { FinishedGoodRepository } from '@/repositories/finished-good.repository'
import { OutletSaleConflict, OutletSaleRepository, type OutletSaleSummary } from '@/repositories/outlet-sale.repository'
import { availabilityAt } from '@/services/stock-transfer.service'

/**
 * Outlet daily sales (Week 10 Task 1, docs/2026-11-22-week10-history-data.md):
 * at closing, an outlet's manager records what was sold that day, per
 * finished good. No approval, like a return — the goods leave the outlet's
 * lots when it is saved. Until this existed, sold goods stayed on the
 * outlet's books (End of Day said so).
 */

export const MAX_SALE_LINES = 30
export const SALE_NOTE_MAX = 1000
export const SALES_PAGE_SIZE = 50

export type OutletSaleViewer = { userId: string; role: string }

export type OutletSaleResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status: number }

export type OutletSaleFormDto = {
  today: string
  yesterday: string
  outlets: {
    id: string
    name: string
    /** today / yesterday already recorded for this outlet. */
    recordedDays: string[]
    goods: {
      finishedGoodId: string
      code: string
      name: string
      unitAbbreviation: string
      sellingPrice: string
      /** Unexpired on hand minus what documents awaiting approval have claimed. */
      available: string
    }[]
  }[]
}

export type OutletSaleListItemDto = {
  id: string
  saleNumber: string
  soldOn: string
  branchName: string
  branchCode: string
  submittedByName: string
  lineCount: number
  totalAmount: string
  totalCost: string
}

export type OutletSaleDetailDto = OutletSaleListItemDto & {
  branchId: string
  notes: string | null
  createdAt: string
  /** totalAmount − totalCost. */
  grossMargin: string
  items: {
    finishedGoodId: string
    code: string
    name: string
    unitAbbreviation: string
    quantity: string
    unitPrice: string
    amount: string
    lots: { lotNumber: string; expiresAt: string | null; quantity: string; cost: string | null }[]
  }[]
}

export type CreateOutletSaleServiceInput = {
  branchId: string
  soldOn: string
  notes?: string | null
  lines: { finishedGoodId: string; quantity: string }[]
}

const canRecord = (role: string) => role === 'ADMIN' || role === 'BRANCH_MANAGER'

/** Midnight UTC of a business date, as soldOn is stored. */
const dateOnly = (date: string) => new Date(`${date}T00:00:00.000Z`)

function toListDto(sale: OutletSaleSummary): OutletSaleListItemDto {
  return {
    id:              sale.id,
    saleNumber:      sale.saleNumber,
    soldOn:          sale.soldOn.toISOString().slice(0, 10),
    branchName:      sale.branch.name,
    branchCode:      sale.branch.code,
    submittedByName: sale.submittedBy.name,
    lineCount:       sale._count.items,
    totalAmount:     toDecimalString(sale.totalAmount),
    totalCost:       toDecimalString(sale.totalCost),
  }
}

/** The outlets a viewer may record for: an ADMIN any active outlet, a branch manager the one they run. */
async function recordableOutlets(viewer: OutletSaleViewer): Promise<{ id: string; name: string }[]> {
  if (!canRecord(viewer.role)) return []
  const outlets = (await BranchRepository.findAllActiveWithType()).filter(b => b.type === BranchType.OUTLET)
  if (viewer.role === 'ADMIN') return outlets.map(b => ({ id: b.id, name: b.name }))
  const managed = await BranchRepository.findManagedBy(viewer.userId)
  return outlets.filter(b => b.id === managed?.id).map(b => ({ id: b.id, name: b.name }))
}

/** A branch manager sees only their outlet's sales; the other allowed roles see every outlet's. */
async function scopeFor(viewer: OutletSaleViewer): Promise<{ branchId: string | null } | null> {
  if (viewer.role !== 'BRANCH_MANAGER') return { branchId: null }
  const managed = await BranchRepository.findManagedBy(viewer.userId)
  return managed ? { branchId: managed.id } : null
}

export const OutletSaleService = {
  /** The form: each outlet the viewer may record for, with what it can sell and which days are done. */
  async getForm(viewer: OutletSaleViewer): Promise<OutletSaleFormDto> {
    const today     = todayIsoDate()
    const yesterday = addDays(today, -1)
    const [outlets, { rows: goods }] = await Promise.all([
      recordableOutlets(viewer),
      FinishedGoodRepository.findMany({ take: 100 }),
    ])
    const recorded = await OutletSaleRepository.recordedDays(outlets.map(o => o.id), [dateOnly(today), dateOnly(yesterday)])
    const now = new Date()

    return {
      today,
      yesterday,
      outlets: await Promise.all(outlets.map(async outlet => ({
        id:           outlet.id,
        name:         outlet.name,
        recordedDays: recorded.filter(r => r.branchId === outlet.id).map(r => r.soldOn.toISOString().slice(0, 10)),
        goods: await Promise.all(goods.filter(good => good.isActive).map(async good => {
          const a = await availabilityAt(good.id, outlet.id, now, null)
          return {
            finishedGoodId:   good.id,
            code:             good.code,
            name:             good.name,
            unitAbbreviation: good.unit.abbreviation,
            sellingPrice:     toDecimalString(good.sellingPrice),
            available:        toDecimalString(Prisma.Decimal.max(a.available, 0)),
          }
        })),
      }))),
    }
  },

  /**
   * Records a day's sales (no approval). Refused: a role other than ADMIN or
   * the outlet's manager (403); a branch that is not an active outlet, a day
   * other than today or yesterday, no lines, a good twice, a quantity ≤ 0
   * (400); more than the outlet has unexpired and unclaimed, or the day
   * already recorded (409).
   */
  async create(input: CreateOutletSaleServiceInput, viewer: OutletSaleViewer): Promise<OutletSaleResult<{ id: string; saleNumber: string }>> {
    if (!canRecord(viewer.role)) {
      return { success: false, error: 'Only an outlet\'s manager, or an admin, records its sales', status: 403 }
    }
    const outlet = (await recordableOutlets(viewer)).find(o => o.id === input.branchId)
    if (!outlet) {
      const branch = await BranchRepository.findById(input.branchId)
      if (branch?.isActive && branch.type === BranchType.COMMISSARY) {
        return { success: false, error: `${branch.name} is a kitchen — sales are recorded at an outlet`, status: 400 }
      }
      return { success: false, error: 'Outlet not found', status: viewer.role === 'ADMIN' ? 400 : 404 }
    }

    const today = todayIsoDate()
    if (input.soldOn !== today && input.soldOn !== addDays(today, -1)) {
      return { success: false, error: 'Sales are recorded for today, or yesterday if you close after midnight', status: 400 }
    }

    if (input.lines.length === 0) return { success: false, error: 'Enter at least one finished good sold', status: 400 }
    if (input.lines.length > MAX_SALE_LINES) return { success: false, error: `At most ${MAX_SALE_LINES} lines`, status: 400 }
    const ids = input.lines.map(line => line.finishedGoodId)
    if (new Set(ids).size !== ids.length) {
      return { success: false, error: 'Each finished good may appear on one line only — add the quantities together', status: 400 }
    }

    const now = new Date()
    const lines = []
    const shortfalls: string[] = []
    for (const line of input.lines) {
      const good = await FinishedGoodRepository.findById(line.finishedGoodId)
      if (!good || !good.isActive) return { success: false, error: 'Finished good not found', status: 400 }
      const quantity = toDecimal(line.quantity)
      if (quantity.lessThanOrEqualTo(0)) {
        return { success: false, error: `${good.name}: the quantity must be greater than zero`, status: 400 }
      }
      const a = await availabilityAt(good.id, outlet.id, now, null)
      if (quantity.greaterThan(a.available)) {
        const unit = good.unit.abbreviation
        shortfalls.push(`${good.name} — ${trimDecimal(toDecimalString(quantity))} ${unit} sold, ${trimDecimal(toDecimalString(Prisma.Decimal.max(a.available, 0)))} ${unit} on the books`)
      }
      lines.push({ finishedGoodId: good.id, name: good.name, unitAbbreviation: good.unit.abbreviation, quantity, unitPrice: good.sellingPrice })
    }
    if (shortfalls.length > 0) {
      return {
        success: false,
        error:   `${outlet.name} does not have that much on its books: ${shortfalls.join('; ')}. Check that every delivery has been received.`,
        status:  409,
      }
    }

    try {
      const sale = await OutletSaleRepository.create({
        branchId: outlet.id, branchName: outlet.name, soldOn: dateOnly(input.soldOn),
        submittedById: viewer.userId, notes: input.notes?.trim() || null, lines,
      })
      signalInventoryChanged([outlet.id])
      return { success: true, data: sale }
    } catch (err) {
      if (err instanceof OutletSaleConflict) return { success: false, error: err.message, status: 409 }
      throw err
    }
  },

  async list(viewer: OutletSaleViewer, page: number): Promise<{ rows: OutletSaleListItemDto[]; total: number } | null> {
    const scope = await scopeFor(viewer)
    if (!scope) return null
    const { rows, total } = await OutletSaleRepository.findMany({
      branchId: scope.branchId, skip: (page - 1) * SALES_PAGE_SIZE, take: SALES_PAGE_SIZE,
    })
    return { rows: rows.map(toListDto), total }
  },

  async getById(id: string, viewer: OutletSaleViewer): Promise<OutletSaleDetailDto | null> {
    const [sale, scope] = await Promise.all([OutletSaleRepository.findById(id), scopeFor(viewer)])
    if (!sale || !scope || (scope.branchId !== null && scope.branchId !== sale.branch.id)) return null
    const lots = await OutletSaleRepository.lotsTaken(id)
    return {
      ...toListDto(sale),
      branchId:  sale.branch.id,
      notes:     sale.notes,
      createdAt: sale.createdAt.toISOString(),
      grossMargin: toDecimalString(sale.totalAmount.sub(sale.totalCost)),
      items: sale.items.map(item => ({
        finishedGoodId:   item.finishedGood.id,
        code:             item.finishedGood.code,
        name:             item.finishedGood.name,
        unitAbbreviation: item.finishedGood.unit.abbreviation,
        quantity:         toDecimalString(item.quantity),
        unitPrice:        toDecimalString(item.unitPrice),
        amount:           toDecimalString(item.amount),
        lots: lots.filter(lot => lot.finishedGoodId === item.finishedGood.id).map(lot => ({
          lotNumber: lot.lotNumber,
          expiresAt: lot.expiresAt?.toISOString() ?? null,
          quantity:  toDecimalString(lot.quantity),
          cost:      lot.unitCost === null ? null : toDecimalString(lot.quantity.mul(lot.unitCost)),
        })),
      })),
    }
  },
}
