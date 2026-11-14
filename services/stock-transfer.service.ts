import { BranchType, Prisma, TransferStatus } from '@prisma/client'
import { toDecimal, toDecimalString } from '@/lib/decimal'
import { expiryFlag, type ExpiryFlag } from '@/lib/dates'
import { trimDecimal } from '@/lib/format'
import { BranchRepository } from '@/repositories/branch.repository'
import { ConversionOrderRepository } from '@/repositories/conversion-order.repository'
import { FinishedGoodRepository } from '@/repositories/finished-good.repository'
import { FinishedGoodStockRepository, planFefoTakes, type LotOnHand } from '@/repositories/finished-good-stock.repository'
import {
  StockTransferRepository,
  StockTransferWithDetail,
} from '@/repositories/stock-transfer.repository'
import { WriteOffRepository } from '@/repositories/write-off.repository'

export type StockTransferLineDto = {
  finishedGoodId: string
  finishedGoodCode: string
  finishedGoodName: string
  unitAbbreviation: string
  quantity: string
}

export type StockTransferSummaryDto = {
  id: string
  transferNumber: string
  status: TransferStatus
  submittedById: string
  fromBranch: { id: string; name: string; code: string }
  toBranch: { id: string; name: string; code: string }
  submittedByName: string
  notes: string | null
  createdAt: string
  lines: StockTransferLineDto[]
}

/** What the sender can send of one finished good (T8). Quantities in the good's unit. */
export type TransferAvailabilityDto = {
  finishedGoodId: string
  finishedGoodName: string
  unitAbbreviation: string
  unexpiredOnHand: string
  /** Never sent (T7) — expired food is a write-off. */
  expiredOnHand: string
  /** Pending conversions, pending write-offs of unexpired lots and other pending transfers. */
  claimed: string
  /** unexpiredOnHand − claimed; may be negative. */
  available: string
}

/** A lot soonest-expiry-first would take for a line (T7). */
export type TransferLotTakeDto = {
  lotNumber: string
  expiresAt: string | null
  expiry: ExpiryFlag | null
  take: string
  /** The lot's recorded cost per unit; null for a lot made before costing. */
  unitCost: string | null
}

export type TransferLinePlanDto = TransferAvailabilityDto & {
  required: string
  enough: boolean
  /** What the unexpired lots do not cover, 0 when they do. */
  short: string
  lots: TransferLotTakeDto[]
  /** Σ take × lot cost; null while short or when a lot has no cost. */
  value: string | null
}

export type TransferPreviewDto = {
  fromBranch: { id: string; name: string }
  /** Every finished good with stock at the sender, plus any good on a line. */
  stock: TransferAvailabilityDto[]
  lines: TransferLinePlanDto[]
  /** Σ line values; null when any line has none. */
  totalValue: string | null
}

export type TransferFormDto = {
  /** Active commissaries — where a transfer may come from (T5). */
  fromBranches: { id: string; name: string }[]
  /** Every active branch; the form leaves out the one sending. */
  toBranches: { id: string; name: string; type: BranchType }[]
  finishedGoods: { id: string; code: string; name: string; unitAbbreviation: string }[]
}

export type CreateStockTransferServiceInput = {
  fromBranchId: string
  toBranchId: string
  notes?: string | null
  lines: { finishedGoodId: string; quantity: string }[]
}

export type StockTransferResult<T> =
  | { success: true;  data: T }
  | { success: false; error: string; status: number }

/** Lines on one transfer — a delivery run, not a stock count. */
export const MAX_TRANSFER_LINES = 30

export type StockTransferDetailDto = StockTransferSummaryDto & {
  /**
   * While pending: each line against the sender's stock now — the lots
   * approving now would take and their value (T7). This transfer's own claim
   * is left out, so it is measured against what it may use. Null once stock
   * has moved (Task 3 shows what did).
   */
  plan: { lines: TransferLinePlanDto[]; totalValue: string | null; allEnough: boolean } | null
}

/** Who is looking — a branch manager sees only their own branch's transfers (T4). */
export type TransferViewer = { userId: string; role: string }

export const TRANSFER_STATUSES = Object.values(TransferStatus)

export function isTransferStatus(value: string): value is TransferStatus {
  return TRANSFER_STATUSES.some(status => status === value)
}

function toSummary(transfer: StockTransferWithDetail): StockTransferSummaryDto {
  return {
    id:              transfer.id,
    transferNumber:  transfer.transferNumber,
    status:          transfer.status,
    submittedById:   transfer.submittedById,
    fromBranch:      transfer.fromBranch,
    toBranch:        transfer.toBranch,
    submittedByName: transfer.submittedBy.name,
    notes:           transfer.notes,
    createdAt:       transfer.createdAt.toISOString(),
    lines: transfer.items.map(item => ({
      finishedGoodId:   item.finishedGood.id,
      finishedGoodCode: item.finishedGood.code,
      finishedGoodName: item.finishedGood.name,
      unitAbbreviation: item.finishedGood.unit.abbreviation,
      quantity:         toDecimalString(item.quantity),
    })),
  }
}

/**
 * The branch a BRANCH_MANAGER may see transfers for: the one they manage,
 * read from Branch.managerId (Week 8 Task 1, B4) — never the login token.
 * `undefined` = no restriction (every other role); `null` = they manage none.
 */
async function viewerBranchScope(viewer: TransferViewer): Promise<{ id: string; name: string } | null | undefined> {
  if (viewer.role !== 'BRANCH_MANAGER') return undefined
  return BranchRepository.findManagedBy(viewer.userId)
}

const zero = new Prisma.Decimal(0)

/**
 * One finished good at the sender, as of `now` (T8): its lots soonest expiry
 * first, what is unexpired and expired, and what documents awaiting approval
 * have claimed — conversions using it as their source, write-offs of its
 * unexpired lots and other transfers from the branch. Nothing is reserved;
 * approval re-checks under a lock (Task 3).
 */
async function availabilityAt(
  finishedGoodId: string,
  branchId: string,
  now: Date,
  excludeTransferId: string | null,
): Promise<{ levels: LotOnHand[]; unexpired: Prisma.Decimal; expired: Prisma.Decimal; claimed: Prisma.Decimal; available: Prisma.Decimal }> {
  const [levels, conversions, writeOffs, transfers] = await Promise.all([
    FinishedGoodStockRepository.lotsOnHand(finishedGoodId, branchId),
    ConversionOrderRepository.pendingSourceAtBranch(finishedGoodId, branchId, null),
    WriteOffRepository.pendingOnUnexpiredLots(finishedGoodId, branchId, now),
    StockTransferRepository.pendingFromBranch(finishedGoodId, branchId, excludeTransferId),
  ])
  let unexpired = zero
  let expired   = zero
  for (const level of levels) {
    if (level.lot.expiresAt !== null && level.lot.expiresAt <= now) expired = expired.add(level.quantity)
    else unexpired = unexpired.add(level.quantity)
  }
  const claimed = conversions.add(writeOffs).add(transfers)
  return { levels, unexpired, expired, claimed, available: unexpired.sub(claimed) }
}

type GoodRef = { id: string; name: string; unit: { abbreviation: string } }

function availabilityDto(good: GoodRef, a: Awaited<ReturnType<typeof availabilityAt>>): TransferAvailabilityDto {
  return {
    finishedGoodId:   good.id,
    finishedGoodName: good.name,
    unitAbbreviation: good.unit.abbreviation,
    unexpiredOnHand:  toDecimalString(a.unexpired),
    expiredOnHand:    toDecimalString(a.expired),
    claimed:          toDecimalString(a.claimed),
    available:        toDecimalString(a.available),
  }
}

/** A line against the sender's stock: enough or not, and the lots FEFO would take, valued at their cost. */
async function planLine(
  good: GoodRef,
  branchId: string,
  required: Prisma.Decimal,
  now: Date,
  excludeTransferId: string | null,
): Promise<TransferLinePlanDto> {
  const a    = await availabilityAt(good.id, branchId, now, excludeTransferId)
  const plan = planFefoTakes(a.levels, required, now)
  const enough = required.lessThanOrEqualTo(a.available)

  let value: Prisma.Decimal | null = plan.short.greaterThan(0) ? null : zero
  const lots = plan.takes.map<TransferLotTakeDto>(take => {
    const unitCost = take.lot.movements[0]?.unitCost ?? null
    if (value !== null) value = unitCost === null ? null : value.add(take.quantity.mul(unitCost))
    return {
      lotNumber: take.lot.lotNumber,
      expiresAt: take.lot.expiresAt?.toISOString() ?? null,
      expiry:    expiryFlag(take.lot.expiresAt, now.getTime()),
      take:      toDecimalString(take.quantity),
      unitCost:  unitCost === null ? null : toDecimalString(unitCost),
    }
  })

  return {
    ...availabilityDto(good, a),
    required: toDecimalString(required),
    enough,
    short:    toDecimalString(Prisma.Decimal.max(required.sub(Prisma.Decimal.max(a.available, 0)), 0)),
    lots,
    value:    value === null ? null : toDecimalString(value),
  }
}

/** The sender must be an active commissary (T5). */
async function senderBranch(fromBranchId: string): Promise<StockTransferResult<{ id: string; name: string }>> {
  const branch = await BranchRepository.findProfile(fromBranchId)
  if (!branch || !branch.isActive) return { success: false, error: 'Sending branch not found', status: 400 }
  if (branch.type !== BranchType.COMMISSARY) {
    return { success: false, error: `${branch.name} is not a commissary — transfers are sent from a commissary`, status: 400 }
  }
  return { success: true, data: { id: branch.id, name: branch.name } }
}

export const StockTransferService = {
  async getForm(): Promise<TransferFormDto> {
    const [branches, { rows: goods }] = await Promise.all([
      BranchRepository.findAll(false),
      FinishedGoodRepository.findMany({ take: 100 }),
    ])
    return {
      fromBranches:  branches.filter(b => b.type === BranchType.COMMISSARY).map(b => ({ id: b.id, name: b.name })),
      toBranches:    branches.map(b => ({ id: b.id, name: b.name, type: b.type })),
      finishedGoods: goods.map(g => ({ id: g.id, code: g.code, name: g.name, unitAbbreviation: g.unit.abbreviation })),
    }
  },

  /**
   * The form's live preview (T7, T8): the sender's stock of every finished
   * good it holds, and for each line with a quantity, the lots it would take
   * and their value. Read-only.
   */
  async preview(input: {
    fromBranchId: string
    lines: { finishedGoodId: string; quantity: string | null }[]
  }): Promise<StockTransferResult<TransferPreviewDto>> {
    const sender = await senderBranch(input.fromBranchId)
    if (!sender.success) return sender

    const now    = new Date()
    const levels = await FinishedGoodStockRepository.findLevels({ branchId: sender.data.id, take: 1000 })
    const goods  = new Map<string, GoodRef>()
    for (const level of levels) {
      const good = level.lot.finishedGood
      goods.set(good.id, { id: good.id, name: good.name, unit: good.unit })
    }
    for (const line of input.lines) {
      if (goods.has(line.finishedGoodId)) continue
      const good = await FinishedGoodRepository.findById(line.finishedGoodId)
      if (!good) return { success: false, error: 'Finished good not found', status: 400 }
      goods.set(good.id, good)
    }

    const sorted = [...goods.values()].sort((a, b) => a.name.localeCompare(b.name))
    const stock  = await Promise.all(sorted.map(async good => availabilityDto(good, await availabilityAt(good.id, sender.data.id, now, null))))

    const lines: TransferLinePlanDto[] = []
    for (const line of input.lines) {
      const good = goods.get(line.finishedGoodId)
      if (!good || line.quantity === null) continue
      lines.push(await planLine(good, sender.data.id, toDecimal(line.quantity), now, null))
    }

    let total: Prisma.Decimal | null = lines.length > 0 ? zero : null
    for (const line of lines) total = total === null || line.value === null ? null : total.add(toDecimal(line.value))

    return {
      success: true,
      data: { fromBranch: sender.data, stock, lines, totalValue: total === null ? null : toDecimalString(total) },
    }
  },

  /**
   * Records a transfer and submits it to accounting in one step (T6): from an
   * active commissary to another active branch, one line per active finished
   * good, each within what the sender can send (T8). Nothing moves until
   * approval (Task 3), which checks the lots again under a lock — two
   * transfers saved at the same moment can both pass here.
   */
  async create(
    input: CreateStockTransferServiceInput,
    actor: { userId: string; role: string },
  ): Promise<StockTransferResult<{ id: string; transferNumber: string }>> {
    const sender = await senderBranch(input.fromBranchId)
    if (!sender.success) return sender

    if (input.toBranchId === input.fromBranchId) {
      return { success: false, error: 'A transfer must go to a different branch', status: 400 }
    }
    const receiver = await BranchRepository.findById(input.toBranchId)
    if (!receiver || !receiver.isActive) {
      return { success: false, error: 'Receiving branch not found', status: 400 }
    }

    if (input.lines.length === 0) {
      return { success: false, error: 'Add at least one finished good', status: 400 }
    }
    if (input.lines.length > MAX_TRANSFER_LINES) {
      return { success: false, error: `A transfer has at most ${MAX_TRANSFER_LINES} lines`, status: 400 }
    }
    const ids = input.lines.map(line => line.finishedGoodId)
    if (new Set(ids).size !== ids.length) {
      return { success: false, error: 'Each finished good may appear on one line only — add the quantities together', status: 400 }
    }

    const now = new Date()
    const shortfalls: string[] = []
    const items: { finishedGoodId: string; quantity: Prisma.Decimal }[] = []
    for (const line of input.lines) {
      const good = await FinishedGoodRepository.findById(line.finishedGoodId)
      if (!good || !good.isActive) {
        return { success: false, error: 'Finished good not found', status: 400 }
      }
      const quantity = toDecimal(line.quantity)
      if (quantity.lessThanOrEqualTo(0)) {
        return { success: false, error: `${good.name}: the quantity must be greater than zero`, status: 400 }
      }
      const a = await availabilityAt(good.id, sender.data.id, now, null)
      if (quantity.greaterThan(a.available)) {
        const unit = good.unit.abbreviation
        shortfalls.push(
          `${good.name} — ${trimDecimal(toDecimalString(quantity))} ${unit} asked, ${trimDecimal(toDecimalString(Prisma.Decimal.max(a.available, 0)))} ${unit} available`
          + (a.claimed.greaterThan(0) ? ` (${trimDecimal(toDecimalString(a.unexpired))} unexpired on hand, ${trimDecimal(toDecimalString(a.claimed))} claimed by documents awaiting approval)` : ''),
        )
      }
      items.push({ finishedGoodId: good.id, quantity })
    }
    if (shortfalls.length > 0) {
      return { success: false, error: `Not enough at ${sender.data.name}: ${shortfalls.join('; ')}`, status: 409 }
    }

    const created = await StockTransferRepository.create({
      fromBranchId:  sender.data.id,
      toBranchId:    receiver.id,
      submittedById: actor.userId,
      notes:         input.notes?.trim() || null,
      items,
    })
    return { success: true, data: created }
  },

  /**
   * Newest first. `branchId` filters to transfers from or to that branch; for
   * a branch manager it is ignored — they only ever see their own (T4).
   */
  async list(
    viewer: TransferViewer,
    filters: { status?: TransferStatus; branchId?: string; skip?: number; take?: number } = {},
  ) {
    const scope = await viewerBranchScope(viewer)
    if (scope === null) {
      return { transfers: [], total: 0, scopedTo: null, managesNoBranch: true }
    }
    const { rows, total } = await StockTransferRepository.findMany({ ...filters, branchId: scope?.id ?? filters.branchId })
    return { transfers: rows.map(toSummary), total, scopedTo: scope ?? null, managesNoBranch: false }
  },

  /**
   * One transfer, or 404 — also for a branch manager it does not concern, so
   * the number of another branch's transfer reveals nothing (T4).
   */
  async getById(id: string, viewer: TransferViewer): Promise<StockTransferResult<StockTransferDetailDto>> {
    const transfer = await StockTransferRepository.findById(id)
    if (!transfer) return { success: false, error: 'Transfer not found', status: 404 }

    const scope = await viewerBranchScope(viewer)
    if (scope !== undefined && (scope === null || (transfer.fromBranchId !== scope.id && transfer.toBranchId !== scope.id))) {
      return { success: false, error: 'Transfer not found', status: 404 }
    }

    const summary = toSummary(transfer)
    if (transfer.status !== TransferStatus.PENDING_APPROVAL) {
      return { success: true, data: { ...summary, plan: null } }
    }

    const now   = new Date()
    const lines: TransferLinePlanDto[] = []
    for (const item of transfer.items) {
      lines.push(await planLine(item.finishedGood, transfer.fromBranchId, item.quantity, now, transfer.id))
    }
    let total: Prisma.Decimal | null = zero
    for (const line of lines) total = total === null || line.value === null ? null : total.add(toDecimal(line.value))

    return {
      success: true,
      data: {
        ...summary,
        plan: {
          lines,
          totalValue: total === null ? null : toDecimalString(total),
          allEnough:  lines.every(line => line.enough),
        },
      },
    }
  },
}
