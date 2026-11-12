import { Prisma, WriteOffReason, WriteOffStatus } from '@prisma/client'
import { toDecimal, toDecimalString } from '@/lib/decimal'
import { trimDecimal } from '@/lib/format'
import { getNotificationQueue, WRITE_OFF_DECIDED, WRITE_OFF_SUBMITTED, type WriteOffJob } from '@/lib/queue'
import { BranchRepository } from '@/repositories/branch.repository'
import { FinishedGoodStockRepository } from '@/repositories/finished-good-stock.repository'
import { ApprovalRepository } from '@/repositories/approval.repository'
import {
  WriteOffDecideResult,
  WriteOffListFilters,
  WriteOffRepository,
  WriteOffWithDetail,
} from '@/repositories/write-off.repository'
import type { ApprovalDto } from '@/services/purchase-request.service'

/**
 * Write-offs (Week 7 Task 2): finished goods that cannot be used or converted
 * — expired, spoiled, damaged — taken out of stock at what they cost. One lot
 * at one branch per write-off (W2). Recording it submits it; accounting's
 * approval moves the stock and records the cost (W4, W6).
 */

/** Every reason, in the order the form lists them, with what people read (W3). */
export const WRITE_OFF_REASONS: { value: WriteOffReason; label: string; hint: string }[] = [
  { value: WriteOffReason.EXPIRED,        label: 'Expired',        hint: 'Past its expiry' },
  { value: WriteOffReason.SPOILED,        label: 'Spoiled',        hint: 'Gone bad before its expiry' },
  { value: WriteOffReason.DAMAGED,        label: 'Damaged',        hint: 'Dropped, contaminated' },
  { value: WriteOffReason.FAILED_QUALITY, label: 'Failed quality', hint: 'Failed a taste or quality check' },
  { value: WriteOffReason.OTHER,          label: 'Other',          hint: 'Say what happened in the notes' },
]

export function reasonLabel(reason: WriteOffReason): string {
  return WRITE_OFF_REASONS.find(option => option.value === reason)?.label ?? reason
}

export function isWriteOffReason(value: string): value is WriteOffReason {
  return WRITE_OFF_REASONS.some(option => option.value === value)
}

/** Every status, in workflow order — the list page's filter options. */
export const WRITE_OFF_STATUSES = Object.values(WriteOffStatus)

export function isWriteOffStatus(value: string): value is WriteOffStatus {
  return WRITE_OFF_STATUSES.some(status => status === value)
}

/** One lot at one branch, as a write-off is recorded against it. */
export type WriteOffLotDto = {
  lotId: string
  lotNumber: string
  finishedGoodId: string
  finishedGoodCode: string
  finishedGoodName: string
  unitAbbreviation: string
  branchId: string
  branchName: string
  /** YYYY-MM-DD. */
  producedOn: string
  /** ISO; null for a lot made before expiry was tracked. */
  expiresAt: string | null
  expired: boolean
  /** What the lot holds at the branch now. */
  onHand: string
  /** Claimed by other write-offs of this lot awaiting approval (W5). */
  pending: string
  /** onHand − pending: the most this write-off may take. */
  available: string
  /** The lot's recorded cost per unit (Week 6 Task 3); null for a lot made before costing. */
  unitCost: string | null
}

export type WriteOffSummaryDto = {
  id: string
  writeOffNumber: string
  status: WriteOffStatus
  reason: WriteOffReason
  reasonLabel: string
  lotId: string
  lotNumber: string
  finishedGoodName: string
  unitAbbreviation: string
  branchName: string
  quantity: string
  /**
   * The peso value lost: recorded at approval (W6); until then an estimate at
   * the lot's cost per unit, which approval records unchanged unless the lot
   * has no cost. Null when it cannot be worked out.
   */
  value: string | null
  /** True once approval has recorded `value`. */
  valueRecorded: boolean
  submittedById: string
  submittedByName: string
  /** ISO. */
  createdAt: string
}

/**
 * What approving a pending write-off does now (W4): the lot at the branch
 * before and after, and the value that would be recorded. Shown to the
 * approver above Approve / Reject.
 */
export type WriteOffEffectDto = {
  /** What the lot holds at the branch now. */
  onHand: string
  /** onHand − quantity. */
  after: string
  /** The lot still holds the quantity — approval is refused otherwise. */
  enough: boolean
  /** Null when the lot has no recorded cost — approval is refused then too. */
  value: string | null
}

/** The WASTE movement an approved write-off wrote, read back from the ledger. */
export type WriteOffStockDto = {
  lotNumber: string
  branchName: string
  /** Signed: negative, out of stock. */
  quantity: string
  unitAbbreviation: string
  unitCost: string | null
  /** ISO. */
  at: string
}

export type WriteOffDetailDto = WriteOffSummaryDto & {
  notes: string | null
  /** While pending: what approving now would do. */
  effect: WriteOffEffectDto | null
  /** Accounting's decision with its remarks, newest first. */
  decisions: ApprovalDto[]
  /** Once approved. */
  stockMoved: WriteOffStockDto | null
  unitCost: string | null
  lot: {
    /** YYYY-MM-DD. */
    producedOn: string
    expiresAt: string | null
    /** Expired as of this read. */
    expired: boolean
    /** Where it came from: a production order or a conversion. */
    source: { kind: 'PRODUCTION' | 'CONVERSION'; id: string } | null
  }
}

/** A row of the approvals inbox (W8). */
export type PendingWriteOffDto = WriteOffSummaryDto & {
  /** The lot still holds the quantity at the branch right now. */
  enough: boolean
}

export type CreateWriteOffServiceInput = {
  lotId: string
  branchId: string
  quantity: string
  reason: WriteOffReason
  notes?: string | null
}

export type WriteOffResult<T> =
  | { success: true;  data: T }
  | { success: false; error: string; status: number }

type Viewer = { userId: string; role: string }

/**
 * The same roles middleware allows on /api/write-offs, repeated so the rule
 * holds wherever the service is called from (W7).
 */
function canWriteOff(role: string) {
  return role === 'ADMIN' || role === 'PRODUCTION_MANAGER'
}

/**
 * Queues a notification job after the change it reports has committed. A
 * queue failure never fails the user's action (docs/architecture.md).
 */
async function enqueue(jobName: string, writeOffId: string): Promise<void> {
  try {
    await getNotificationQueue().add(jobName, { writeOffId } satisfies WriteOffJob)
  } catch (err) {
    console.error(`[WriteOffService] could not enqueue ${jobName}`, err)
  }
}

function toSummaryDto(row: WriteOffWithDetail): WriteOffSummaryDto {
  const lotCost  = row.lot.movements[0]?.unitCost ?? null
  const recorded = row.totalCost
  const estimate = lotCost === null ? null : row.quantity.mul(lotCost)
  const value    = recorded ?? (row.status === WriteOffStatus.REJECTED ? null : estimate)
  return {
    id:               row.id,
    writeOffNumber:   row.writeOffNumber,
    status:           row.status,
    reason:           row.reason,
    reasonLabel:      reasonLabel(row.reason),
    lotId:            row.lot.id,
    lotNumber:        row.lot.lotNumber,
    finishedGoodName: row.lot.finishedGood.name,
    unitAbbreviation: row.lot.finishedGood.unit.abbreviation,
    branchName:       row.branch.name,
    quantity:         toDecimalString(row.quantity),
    value:            value === null ? null : toDecimalString(value),
    valueRecorded:    recorded !== null,
    submittedById:    row.submittedBy.id,
    submittedByName:  row.submittedBy.name,
    createdAt:        row.createdAt.toISOString(),
  }
}

/** The lot at the branch with what is still free to write off, or null if it holds nothing there. */
async function lotAtBranch(lotId: string, branchId: string, excludeId: string | null, now: Date): Promise<{
  dto: WriteOffLotDto
  available: Prisma.Decimal
} | null> {
  const [level, pending] = await Promise.all([
    FinishedGoodStockRepository.findLotAtBranch(lotId, branchId),
    WriteOffRepository.pendingOnLot(lotId, branchId, excludeId),
  ])
  if (!level) return null

  const unitCost  = level.lot.movements[0]?.unitCost ?? null
  const available = level.quantity.sub(pending)
  return {
    available,
    dto: {
      lotId:            level.lot.id,
      lotNumber:        level.lot.lotNumber,
      finishedGoodId:   level.lot.finishedGood.id,
      finishedGoodCode: level.lot.finishedGood.code,
      finishedGoodName: level.lot.finishedGood.name,
      unitAbbreviation: level.lot.finishedGood.unit.abbreviation,
      branchId:         level.branch.id,
      branchName:       level.branch.name,
      producedOn:       level.lot.producedOn.toISOString().slice(0, 10),
      expiresAt:        level.lot.expiresAt?.toISOString() ?? null,
      expired:          level.lot.expiresAt !== null && level.lot.expiresAt <= now,
      onHand:           toDecimalString(level.quantity),
      pending:          toDecimalString(pending),
      available:        toDecimalString(available),
      unitCost:         unitCost === null ? null : toDecimalString(unitCost),
    },
  }
}

export const WriteOffService = {
  /** Newest first, with the value of the approved ones among all that match. No viewer scoping. */
  async list(filters: WriteOffListFilters = {}) {
    const { rows, total, approvedValue } = await WriteOffRepository.findMany(filters)
    return { writeOffs: rows.map(toSummaryDto), total, approvedValue: toDecimalString(approvedValue) }
  },

  async getById(id: string): Promise<WriteOffResult<WriteOffDetailDto>> {
    const row = await WriteOffRepository.findById(id)
    if (!row) {
      return { success: false, error: 'Write-off not found', status: 404 }
    }

    const isPending = row.status === WriteOffStatus.PENDING_APPROVAL
    const [level, decisions, movements] = await Promise.all([
      isPending ? FinishedGoodStockRepository.findLotAtBranch(row.lot.id, row.branch.id) : null,
      ApprovalRepository.findByReference('WriteOff', row.id),
      row.status === WriteOffStatus.APPROVED ? FinishedGoodStockRepository.findMovementsByReference('WriteOff', row.id) : [],
    ])

    const lotCost = row.lot.movements[0]?.unitCost ?? null
    const onHand  = level?.quantity ?? new Prisma.Decimal(0)
    const out     = movements.find(movement => movement.quantity.lessThan(0))
    return {
      success: true,
      data: {
        ...toSummaryDto(row),
        notes:    row.notes,
        effect:   isPending ? {
          onHand: toDecimalString(onHand),
          after:  toDecimalString(onHand.sub(row.quantity)),
          enough: onHand.greaterThanOrEqualTo(row.quantity),
          value:  lotCost === null ? null : toDecimalString(row.quantity.mul(lotCost)),
        } : null,
        decisions: decisions.map(decision => ({
          id:           decision.id,
          decision:     decision.decision,
          remarks:      decision.remarks,
          approverName: decision.approver.name,
          decidedAt:    decision.decidedAt.toISOString(),
        })),
        stockMoved: out ? {
          lotNumber:        out.lot.lotNumber,
          branchName:       out.branch.name,
          quantity:         toDecimalString(out.quantity),
          unitAbbreviation: out.lot.finishedGood.unit.abbreviation,
          unitCost:         out.unitCost === null ? null : toDecimalString(out.unitCost),
          at:               out.createdAt.toISOString(),
        } : null,
        // Recorded at approval; until then the lot's cost, which is what approval records.
        unitCost: row.unitCost !== null ? toDecimalString(row.unitCost) : lotCost === null ? null : toDecimalString(lotCost),
        lot: {
          producedOn: row.lot.producedOn.toISOString().slice(0, 10),
          expiresAt:  row.lot.expiresAt?.toISOString() ?? null,
          expired:    row.lot.expiresAt !== null && row.lot.expiresAt <= new Date(),
          source:     row.lot.productionOrderId !== null
            ? { kind: 'PRODUCTION', id: row.lot.productionOrderId }
            : row.lot.conversionOrderId !== null
              ? { kind: 'CONVERSION', id: row.lot.conversionOrderId }
              : null,
        },
      },
    }
  },

  /**
   * The approvals inbox's write-offs (W8), oldest first, each with whether
   * its lot still holds the quantity. One level read per row, bounded by `take`.
   */
  async listPending(take = 100): Promise<PendingWriteOffDto[]> {
    const rows = await WriteOffRepository.findPending(take)
    return Promise.all(rows.map(async row => {
      const level = await FinishedGoodStockRepository.findLotAtBranch(row.lot.id, row.branch.id)
      return { ...toSummaryDto(row), enough: (level?.quantity ?? new Prisma.Decimal(0)).greaterThanOrEqualTo(row.quantity) }
    }))
  },

  /** The form for one lot at one branch; null when the lot holds nothing there or the branch is unknown. */
  async getForm(lotId: string, branchId: string): Promise<WriteOffLotDto | null> {
    const lot = await lotAtBranch(lotId, branchId, null, new Date())
    return lot !== null && toDecimal(lot.dto.onHand).greaterThan(0) ? lot.dto : null
  },

  /**
   * Records a write-off and submits it, in one step (W4): created
   * PENDING_APPROVAL, the caller as submitter. The lot must hold at least the
   * quantity at the branch, less what other pending write-offs of it claim
   * (W5); approval checks again under a lock. Expired lots are the usual case
   * and are allowed. Nothing moves in stock here.
   */
  async create(
    input: CreateWriteOffServiceInput,
    viewer: Viewer,
  ): Promise<WriteOffResult<{ id: string; writeOffNumber: string }>> {
    if (!canWriteOff(viewer.role)) {
      return { success: false, error: 'Only production can record a write-off', status: 403 }
    }

    const branch = await BranchRepository.findById(input.branchId)
    if (!branch || !branch.isActive) {
      return { success: false, error: 'Branch not found', status: 400 }
    }
    const lot = await lotAtBranch(input.lotId, input.branchId, null, new Date())
    if (!lot || !toDecimal(lot.dto.onHand).greaterThan(0)) {
      return { success: false, error: 'That lot has nothing on hand at this branch', status: 400 }
    }

    const unit     = lot.dto.unitAbbreviation
    const quantity = toDecimal(input.quantity)
    if (quantity.lessThanOrEqualTo(0)) {
      return { success: false, error: 'Enter how much is being written off', status: 400 }
    }
    if (quantity.greaterThan(lot.available)) {
      const pending = toDecimal(lot.dto.pending)
      return {
        success: false,
        error:   `Lot ${lot.dto.lotNumber} has only ${trimDecimal(lot.dto.available)} ${unit} left to write off at ${lot.dto.branchName}`
          + (pending.greaterThan(0) ? ` (${trimDecimal(lot.dto.onHand)} on hand, ${trimDecimal(lot.dto.pending)} in write-offs awaiting approval)` : '')
          + ` — you entered ${trimDecimal(toDecimalString(quantity))} ${unit}`,
        status:  400,
      }
    }

    const notes = input.notes?.trim() || null
    if (input.reason === WriteOffReason.OTHER && notes === null) {
      return { success: false, error: 'Say what happened in the notes when the reason is Other', status: 400 }
    }

    const created = await WriteOffRepository.create({
      lotId:         lot.dto.lotId,
      branchId:      lot.dto.branchId,
      submittedById: viewer.userId,
      quantity,
      reason:        input.reason,
      notes,
    })
    await enqueue(WRITE_OFF_SUBMITTED, created.id)
    return { success: true, data: created }
  },

  /**
   * Accounting's decision (W4), from POST /api/approvals with referenceType
   * 'WriteOff', which middleware restricts to ACCOUNTING and ADMIN. Never
   * whoever recorded it, ADMIN included; a reason to reject; REJECTED is
   * final — production records it again. Approving takes the quantity out of
   * the lot as WASTE and records its cost (W6); the lot is re-checked under a
   * lock inside the transaction.
   */
  async applyDecision(
    id: string,
    viewer: Viewer,
    decision: 'APPROVED' | 'REJECTED',
    remarks: string | null,
  ): Promise<WriteOffResult<{ id: string; writeOffNumber: string }>> {
    const row = await WriteOffRepository.findById(id)
    if (!row) {
      return { success: false, error: 'Write-off not found', status: 404 }
    }
    if (row.submittedBy.id === viewer.userId) {
      return { success: false, error: 'You recorded this write-off, so someone else has to decide it', status: 403 }
    }
    if (row.status !== WriteOffStatus.PENDING_APPROVAL) {
      return {
        success: false,
        error:   `This write-off is ${row.status.replace(/_/g, ' ').toLowerCase()} and is no longer awaiting a decision`,
        status:  409,
      }
    }
    if (decision === 'REJECTED' && (remarks === null || remarks.trim() === '')) {
      return { success: false, error: 'Give a reason when rejecting, so production knows what to correct', status: 400 }
    }

    const result: WriteOffDecideResult = await WriteOffRepository.decide({
      id,
      approverId: viewer.userId,
      remarks,
      decision: decision === 'REJECTED' ? { kind: 'REJECTED' } : {
        kind:             'APPROVED',
        writeOffNumber:   row.writeOffNumber,
        lotId:            row.lot.id,
        lotNumber:        row.lot.lotNumber,
        finishedGoodId:   row.lot.finishedGood.id,
        branchId:         row.branch.id,
        quantity:         row.quantity,
        unitAbbreviation: row.lot.finishedGood.unit.abbreviation,
      },
    })

    if (!result.ok) {
      return result.reason === 'not-pending'
        ? { success: false, error: 'This write-off was decided by someone else just now — reload', status: 409 }
        : { success: false, error: result.message, status: 409 }
    }
    await enqueue(WRITE_OFF_DECIDED, id)
    return { success: true, data: { id: row.id, writeOffNumber: row.writeOffNumber } }
  },
}
