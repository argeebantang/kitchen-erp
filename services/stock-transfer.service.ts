import { BranchType, Prisma, TransferStatus, TransferVarianceReason } from '@prisma/client'
import { toDecimal, toDecimalString } from '@/lib/decimal'
import { expiryFlag, type ExpiryFlag } from '@/lib/dates'
import { trimDecimal } from '@/lib/format'
import { ApprovalRepository } from '@/repositories/approval.repository'
import { BranchRepository } from '@/repositories/branch.repository'
import { ConversionOrderRepository } from '@/repositories/conversion-order.repository'
import { FinishedGoodRepository } from '@/repositories/finished-good.repository'
import { FinishedGoodStockRepository, planFefoTakes, type LotOnHand } from '@/repositories/finished-good-stock.repository'
import {
  StockTransferRepository,
  StockTransferWithDetail,
  type StockTransferDecideResult,
} from '@/repositories/stock-transfer.repository'
import { WriteOffRepository } from '@/repositories/write-off.repository'
import {
  getNotificationQueue,
  TRANSFER_DECIDED,
  TRANSFER_RECEIVED,
  TRANSFER_SUBMITTED,
  type StockTransferJob,
} from '@/lib/queue'

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
  /** Who confirmed it arrived, and when (R3); null until RECEIVED. */
  receivedByName: string | null
  receivedAt: string | null
  /** Pesos lost in transit at lot cost, recorded at receipt (V5); null until received. */
  varianceValue: string | null
  varianceReason: string | null
  varianceNotes: string | null
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

/** One lot moved by a transfer, at one end: out of the sender or into the receiver. */
export type TransferMovementDto = {
  lotId: string
  lotNumber: string
  finishedGoodName: string
  unitAbbreviation: string
  branchName: string
  /** Positive, whichever way it went. */
  quantity: string
  /** The lot's cost per unit, carried on the movement. */
  unitCost: string | null
  value: string | null
  expiresAt: string | null
  /** As of the page's render — a lot may expire in transit (R6). */
  expiry: ExpiryFlag | null
  at: string
}

/** Transfers that arrived short and what they lost at cost; `unvalued` of them include a lot with no cost. */
export type TransferLostTotalDto = { count: number; value: string; unvalued: number }

/** One lot that arrived short — the difference was lost on the road (V3), valued at the lot's cost. */
export type TransferShortLotDto = {
  lotId: string
  lotNumber: string
  finishedGoodName: string
  unitAbbreviation: string
  sent: string
  received: string
  short: string
  unitCost: string | null
  value: string | null
}

export type StockTransferDetailDto = StockTransferSummaryDto & {
  /** In transit and the viewer may confirm it arrived: the receiving branch's manager, or an ADMIN (R3). */
  canReceive: boolean
  decisions: { id: string; decision: string; remarks: string | null; approverName: string; decidedAt: string }[]
  /**
   * Each lot that arrived short (Task 4, V5): sent from the TRANSFER (−) row,
   * received from the TRANSFER (+) row (0 when none). Empty until received,
   * and when everything arrived.
   */
  lostInTransit: TransferShortLotDto[]
  /** What left the sender on approval and arrived on receipt (R1, R3); empty sides until then. */
  stockMoved: {
    out: TransferMovementDto[]
    in: TransferMovementDto[]
    outValue: string | null
    inValue: string | null
  }
  /**
   * While pending: each line against the sender's stock now — the lots
   * approving now would take and their value (T7). This transfer's own claim
   * is left out, so it is measured against what it may use. Null once stock
   * has moved (Task 3 shows what did).
   */
  plan: { lines: TransferLinePlanDto[]; totalValue: string | null; allEnough: boolean } | null
}

/** A transfer in the approvals inbox: what it sends, what it is worth now, and whether the sender still has it. */
export type PendingTransferDto = StockTransferSummaryDto & {
  totalValue: string | null
  allEnough: boolean
}

/** Who is looking — a branch manager sees only their own branch's transfers (T4). */
export type TransferViewer = { userId: string; role: string }

/** What the receiving branch counted (Task 4): one row per dispatched lot; reason and notes when anything is short. */
export type TransferReceiptInput = {
  lots: { lotId: string; received: string }[]
  reason: TransferVarianceReason | null
  notes: string | null
}

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
    receivedByName:  transfer.receivedBy?.name ?? null,
    receivedAt:      transfer.receivedAt?.toISOString() ?? null,
    varianceValue:   transfer.varianceValue === null ? null : toDecimalString(transfer.varianceValue),
    varianceReason:  transfer.varianceReason,
    varianceNotes:   transfer.varianceNotes,
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

/**
 * Notifications go through the queue, after the transaction has committed
 * (R7). A queue outage is logged, never surfaced: the transfer is already
 * recorded, decided or received, and that is what matters.
 */
async function enqueue(jobName: string, stockTransferId: string): Promise<void> {
  try {
    await getNotificationQueue().add(jobName, { stockTransferId } satisfies StockTransferJob)
  } catch (err) {
    console.error(`[StockTransferService] could not enqueue ${jobName}`, err)
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

/**
 * Who may confirm a transfer arrived (R3): the manager of the receiving
 * branch, read from Branch.managerId — not the login token — or an ADMIN.
 */
async function mayReceive(viewer: TransferViewer, toBranchId: string): Promise<boolean> {
  if (viewer.role === 'ADMIN') return true
  if (viewer.role !== 'BRANCH_MANAGER') return false
  const managed = await BranchRepository.findManagedBy(viewer.userId)
  return managed?.id === toBranchId
}

/** Each line of a pending transfer against the sender's stock now, its own claim left out (T7, T8). */
async function pendingPlan(transfer: StockTransferWithDetail, now: Date): Promise<NonNullable<StockTransferDetailDto['plan']>> {
  const lines: TransferLinePlanDto[] = []
  for (const item of transfer.items) {
    lines.push(await planLine(item.finishedGood, transfer.fromBranchId, item.quantity, now, transfer.id))
  }
  let total: Prisma.Decimal | null = zero
  for (const line of lines) total = total === null || line.value === null ? null : total.add(toDecimal(line.value))
  return {
    lines,
    totalValue: total === null ? null : toDecimalString(total),
    allEnough:  lines.every(line => line.enough),
  }
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
    await enqueue(TRANSFER_SUBMITTED, created.id)
    return { success: true, data: created }
  },

  /**
   * Newest first. `branchId` filters to transfers from or to that branch; for
   * a branch manager it is ignored — they only ever see their own (T4).
   */
  async list(
    viewer: TransferViewer,
    filters: { status?: TransferStatus; branchId?: string; shortOnly?: boolean; skip?: number; take?: number } = {},
  ): Promise<{
    transfers: StockTransferSummaryDto[]
    total: number
    /** Across every transfer the filters match, not just this page (V7). */
    lost: TransferLostTotalDto
    scopedTo: { id: string; name: string } | null
    managesNoBranch: boolean
  }> {
    const scope = await viewerBranchScope(viewer)
    if (scope === null) {
      return { transfers: [], total: 0, lost: { count: 0, value: '0', unvalued: 0 }, scopedTo: null, managesNoBranch: true }
    }
    const { rows, total, lost } = await StockTransferRepository.findMany({ ...filters, branchId: scope?.id ?? filters.branchId })
    return {
      transfers: rows.map(toSummary),
      total,
      lost: { count: lost.count, value: toDecimalString(lost.value), unvalued: lost.unvalued },
      scopedTo: scope ?? null,
      managesNoBranch: false,
    }
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

    const now = new Date()
    const [decisions, movements] = await Promise.all([
      ApprovalRepository.findByReference('StockTransfer', transfer.id),
      FinishedGoodStockRepository.findMovementsByReference('StockTransfer', transfer.id),
    ])
    const toMovement = (m: (typeof movements)[number]): TransferMovementDto => {
      const quantity = m.quantity.abs()
      return {
        lotId:            m.lotId,
        lotNumber:        m.lot.lotNumber,
        finishedGoodName: m.lot.finishedGood.name,
        unitAbbreviation: m.lot.finishedGood.unit.abbreviation,
        branchName:       m.branch.name,
        quantity:         toDecimalString(quantity),
        unitCost:         m.unitCost === null ? null : toDecimalString(m.unitCost),
        value:            m.unitCost === null ? null : toDecimalString(quantity.mul(m.unitCost)),
        expiresAt:        m.lot.expiresAt?.toISOString() ?? null,
        expiry:           expiryFlag(m.lot.expiresAt, now.getTime()),
        at:               m.createdAt.toISOString(),
      }
    }
    const sideValue = (side: TransferMovementDto[]): string | null => {
      if (side.length === 0) return null
      let total = zero
      for (const m of side) {
        if (m.value === null) return null
        total = total.add(toDecimal(m.value))
      }
      return toDecimalString(total)
    }
    const out = movements.filter(m => m.quantity.lessThan(0)).map(toMovement)
    const arrived = movements.filter(m => m.quantity.greaterThan(0)).map(toMovement)

    // One TRANSFER row per lot at each end (see StockTransferRepository.receive).
    const lostInTransit: TransferShortLotDto[] = []
    if (transfer.status === TransferStatus.RECEIVED) {
      const arrivedByLot = new Map(arrived.map(m => [m.lotId, toDecimal(m.quantity)]))
      for (const lot of out) {
        const sent     = toDecimal(lot.quantity)
        const received = arrivedByLot.get(lot.lotId) ?? zero
        const short    = sent.sub(received)
        if (!short.greaterThan(0)) continue
        lostInTransit.push({
          lotId:            lot.lotId,
          lotNumber:        lot.lotNumber,
          finishedGoodName: lot.finishedGoodName,
          unitAbbreviation: lot.unitAbbreviation,
          sent:             toDecimalString(sent),
          received:         toDecimalString(received),
          short:            toDecimalString(short),
          unitCost:         lot.unitCost,
          value:            lot.unitCost === null ? null : toDecimalString(short.mul(toDecimal(lot.unitCost))),
        })
      }
    }

    const base = {
      ...toSummary(transfer),
      canReceive: transfer.status === TransferStatus.APPROVED && await mayReceive(viewer, transfer.toBranchId),
      decisions: decisions.map(d => ({
        id:           d.id,
        decision:     d.decision,
        remarks:      d.remarks,
        approverName: d.approver.name,
        decidedAt:    d.decidedAt.toISOString(),
      })),
      lostInTransit,
      stockMoved: { out, in: arrived, outValue: sideValue(out), inValue: sideValue(arrived) },
    }
    if (transfer.status !== TransferStatus.PENDING_APPROVAL) {
      return { success: true, data: { ...base, plan: null } }
    }

    return { success: true, data: { ...base, plan: await pendingPlan(transfer, now) } }
  },

  /** Pending transfers, oldest first, each planned against the sender now — the approvals inbox (R8). */
  async listPending(take = 100): Promise<PendingTransferDto[]> {
    const rows = await StockTransferRepository.findPending(take)
    const now  = new Date()
    return Promise.all(rows.map(async row => {
      const plan = await pendingPlan(row, now)
      return { ...toSummary(row), totalValue: plan.totalValue, allEnough: plan.allEnough }
    }))
  },

  /**
   * The receiving branch confirms what arrived (R3; Task 4, V1–V8):
   * APPROVED → RECEIVED, the counted lots join its stock and any shortfall is
   * recorded as lost in transit. Its manager or an ADMIN only; a branch
   * manager it does not concern gets 404, as on the page. Every dispatched
   * lot is counted exactly once, 0 ≤ received ≤ sent (more than sent is a
   * dispatch miscount, not a receipt — V2); anything short needs a reason, and
   * a note when the reason is Other (V4). Logged, not approved (V6).
   */
  async receive(id: string, viewer: TransferViewer, count: TransferReceiptInput): Promise<StockTransferResult<{
    id: string
    transferNumber: string
    status: TransferStatus
    varianceValue: string | null
  }>> {
    const visible = await StockTransferService.getById(id, viewer)
    if (!visible.success) return visible
    const transfer = visible.data

    if (!(await mayReceive(viewer, transfer.toBranch.id))) {
      return {
        success: false,
        error:   `Only the manager of ${transfer.toBranch.name}, or an admin, can confirm this transfer arrived`,
        status:  403,
      }
    }
    if (transfer.status !== TransferStatus.APPROVED) {
      const why = transfer.status === TransferStatus.PENDING_APPROVAL
        ? 'is still waiting for accounting — nothing has been sent yet'
        : transfer.status === TransferStatus.RECEIVED
          ? 'has already been received'
          : 'was rejected — nothing was sent'
      return { success: false, error: `${transfer.transferNumber} ${why}`, status: 409 }
    }

    // Counts against the lots that left the sender. Those rows are fixed once
    // dispatched; the repository reads them again in its transaction.
    const dispatched = new Map(transfer.stockMoved.out.map(lot => [lot.lotId, lot]))
    const received   = new Map<string, Prisma.Decimal>()
    for (const row of count.lots) {
      const lot = dispatched.get(row.lotId)
      if (!lot) {
        return { success: false, error: `A counted lot was not sent on ${transfer.transferNumber} — reload and count again`, status: 400 }
      }
      if (received.has(row.lotId)) {
        return { success: false, error: `${lot.finishedGoodName} ${lot.lotNumber} is counted twice`, status: 400 }
      }
      const quantity = toDecimal(row.received)
      if (quantity.greaterThan(toDecimal(lot.quantity))) {
        return {
          success: false,
          error:   `${lot.finishedGoodName} ${lot.lotNumber}: ${trimDecimal(row.received)} ${lot.unitAbbreviation} counted but only ${trimDecimal(lot.quantity)} ${lot.unitAbbreviation} was sent — a dispatch miscount; tell the kitchen`,
          status:  400,
        }
      }
      received.set(row.lotId, quantity)
    }
    const uncounted = transfer.stockMoved.out.filter(lot => !received.has(lot.lotId))
    if (uncounted.length > 0) {
      return {
        success: false,
        error:   `Count every lot that was sent — missing: ${uncounted.map(lot => `${lot.finishedGoodName} ${lot.lotNumber}`).join(', ')}`,
        status:  400,
      }
    }

    const anyShort = transfer.stockMoved.out.some(lot => toDecimal(lot.quantity).greaterThan(received.get(lot.lotId) ?? zero))
    const notes    = count.notes?.trim() || null
    if (anyShort && count.reason === null) {
      return { success: false, error: 'Something arrived short — choose why', status: 400 }
    }
    if (anyShort && count.reason === TransferVarianceReason.OTHER && notes === null) {
      return { success: false, error: 'Say what happened when the reason is Other', status: 400 }
    }

    const result = await StockTransferRepository.receive({
      id,
      receiverId:     viewer.userId,
      toBranchId:     transfer.toBranch.id,
      transferNumber: transfer.transferNumber,
      received,
      // Nothing short, nothing to explain: a stray reason is not kept.
      varianceReason: anyShort ? count.reason : null,
      varianceNotes:  anyShort ? notes : null,
    })
    if (!result.ok) {
      return { success: false, error: 'This transfer was just received by someone else — reload', status: 409 }
    }
    await enqueue(TRANSFER_RECEIVED, id)
    return {
      success: true,
      data: {
        id,
        transferNumber: transfer.transferNumber,
        status:         TransferStatus.RECEIVED,
        varianceValue:  result.varianceValue === null ? null : toDecimalString(result.varianceValue),
      },
    }
  },

  /**
   * Accounting's decision (R1) — never by whoever recorded it, ADMIN
   * included; a reason to reject; rejection is final. Approving dispatches:
   * the lots are locked and re-planned, and refused if short (409).
   */
  async applyDecision(
    id: string,
    viewer: TransferViewer,
    decision: 'APPROVED' | 'REJECTED',
    remarks: string | null,
  ): Promise<StockTransferResult<{ id: string; transferNumber: string; status: TransferStatus }>> {
    const transfer = await StockTransferRepository.findById(id)
    if (!transfer) {
      return { success: false, error: 'Transfer not found', status: 404 }
    }
    if (transfer.submittedById === viewer.userId) {
      return { success: false, error: 'You recorded this transfer, so someone else has to decide it', status: 403 }
    }
    if (transfer.status !== TransferStatus.PENDING_APPROVAL) {
      return {
        success: false,
        error:   `This transfer is ${transfer.status.replace(/_/g, ' ').toLowerCase()} and is no longer awaiting a decision`,
        status:  409,
      }
    }
    if (decision === 'REJECTED' && (remarks === null || remarks.trim() === '')) {
      return { success: false, error: 'Give a reason when rejecting, so production knows what to correct', status: 400 }
    }

    const result: StockTransferDecideResult = await StockTransferRepository.decide({
      id,
      approverId: viewer.userId,
      remarks,
      decision: decision === 'REJECTED' ? { kind: 'REJECTED' } : {
        kind:           'APPROVED',
        transferNumber: transfer.transferNumber,
        fromBranchId:   transfer.fromBranchId,
        fromBranchName: transfer.fromBranch.name,
        lines: transfer.items.map(item => ({
          finishedGoodId:   item.finishedGood.id,
          name:             item.finishedGood.name,
          unitAbbreviation: item.finishedGood.unit.abbreviation,
          quantity:         item.quantity,
        })),
      },
    })

    if (!result.ok) {
      return result.reason === 'not-pending'
        ? { success: false, error: 'This transfer was decided by someone else just now — reload', status: 409 }
        : { success: false, error: result.message, status: 409 }
    }
    await enqueue(TRANSFER_DECIDED, id)
    return {
      success: true,
      data: { id, transferNumber: transfer.transferNumber, status: decision === 'APPROVED' ? TransferStatus.APPROVED : TransferStatus.REJECTED },
    }
  },
}
