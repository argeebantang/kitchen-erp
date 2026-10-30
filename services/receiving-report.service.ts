import { POStatus, Prisma, Role, RRStatus } from '@prisma/client'
import { toDecimal, toDecimalString } from '@/lib/decimal'
import { todayIsoDate } from '@/lib/dates'
import { PurchaseOrderRepository, PurchaseOrderWithDetail } from '@/repositories/purchase-order.repository'
import {
  ReceivingReportLineInput,
  ReceivingReportListFilters,
  ReceivingReportRepository,
} from '@/repositories/receiving-report.repository'
import { BranchRepository } from '@/repositories/branch.repository'
import { ApprovalRepository } from '@/repositories/approval.repository'
import type { ApprovalDto } from '@/services/purchase-request.service'

/** One purchase order line as the receiving form shows it. */
export type ReceivingLineDto = {
  purchaseOrderItemId: string
  materialCode: string
  materialName: string
  unitAbbreviation: string
  orderedQuantity: string
  alreadyReceived: string
  outstanding: string
  /** Copied from the PO line; the form prices the variance with it. */
  unitCost: string
}

export type ReceivingFormDto = {
  purchaseOrderId: string
  poNumber: string
  status: POStatus
  supplierName: string | null
  /** False when the order is not out with a supplier, or nothing is owed. */
  receivable: boolean
  /** Set when a DRAFT or PENDING report already exists on this order. */
  openReport: { id: string; rrNumber: string } | null
  branches: { id: string; name: string }[]
  lines: ReceivingLineDto[]
}

/** An edit can change everything except which order the report is against. */
export type UpdateReceivingReportInput = Omit<CreateReceivingReportInput, 'purchaseOrderId'>

export type CreateReceivingReportInput = {
  purchaseOrderId: string
  branchId: string
  receivedAt: string
  notes?: string | null
  items: {
    purchaseOrderItemId: string
    receivedQuantity: string
    rejectedQuantity: string
    notes?: string | null
  }[]
}

export type ReceivingReportSummaryDto = {
  id: string
  rrNumber: string
  status: RRStatus
  purchaseOrderId: string
  poNumber: string
  supplierName: string | null
  branchName: string
  receivedByName: string
  receivedAt: string
  lineCount: number
  /** Lines whose count differs from what was expected; 0 is a match. */
  varianceLineCount: number
  /** What the report adds to stock on approval: Σ accepted × unit cost. */
  acceptedValue: string
}

export type ReceivingReportLineDto = {
  id: string
  purchaseOrderItemId: string
  materialCode: string
  materialName: string
  unitAbbreviation: string
  orderedQuantity: string
  receivedQuantity: string
  rejectedQuantity: string
  acceptedQuantity: string
  unitCost: string
  /** accepted × unitCost: the value this line adds to stock on approval. */
  acceptedValue: string
  /** What the supplier still owed on this line when it was counted. */
  expectedQuantity: string
  variance: LineVarianceDto
  notes: string | null
}

/**
 * How a line's count departs from what was expected. Each part is zero when it
 * does not apply; all three zero is a match.
 *
 * - short: accepted below expected — still owed, stays outstanding on the order.
 * - over: received above expected — the extra, which the line must enter as
 *   rejected (accepted can never exceed outstanding).
 * - rejected: the rest of the rejected quantity — refused for another reason.
 *
 * Values are quantity × the line's unit cost.
 */
export type LineVarianceDto = {
  hasVariance: boolean
  shortQuantity: string
  shortValue: string
  overQuantity: string
  overValue: string
  rejectedQuantity: string
  rejectedValue: string
}

export type ReportVarianceDto = {
  lineCount: number
  shortValue: string
  overValue: string
  rejectedValue: string
}

export type ReceivingReportDetailDto = {
  id: string
  rrNumber: string
  status: RRStatus
  purchaseOrderId: string
  poNumber: string
  poStatus: POStatus
  supplierName: string | null
  branchId: string
  branchName: string
  receivedById: string
  receivedByName: string
  receivedAt: string
  notes: string | null
  createdAt: string
  acceptedValue: string
  variance: ReportVarianceDto
  lines: ReceivingReportLineDto[]
  /** Newest first. Empty until accounting decides. */
  decisions: ApprovalDto[]
}

export type ReceivingReportResult<T> =
  | { success: true;  data: T }
  | { success: false; error: string; status: number }

type Viewer = { userId: string; role: string }

// Only these orders are out with a supplier and still owed something.
const RECEIVABLE_STATUSES: POStatus[] = [POStatus.SENT, POStatus.PARTIALLY_RECEIVED]

function canReceive(role: string) {
  return role === Role.PROCUREMENT_MANAGER || role === Role.ADMIN
}

function statusText(status: POStatus) {
  return status.replace(/_/g, ' ').toLowerCase()
}

/**
 * Ordered, accepted-so-far and outstanding per PO line. Outstanding is what
 * the supplier still owes: ordered minus what APPROVED reports accepted.
 * Floored at zero so a line can never show a negative balance.
 */
async function lineBalances(po: PurchaseOrderWithDetail) {
  const accepted = await ReceivingReportRepository.acceptedByLine(po.id)
  const zero = new Prisma.Decimal(0)

  return po.items.map(item => {
    const alreadyReceived = accepted.get(item.id) ?? zero
    return {
      item,
      alreadyReceived,
      outstanding: Prisma.Decimal.max(item.quantity.sub(alreadyReceived), zero),
    }
  })
}

/**
 * Splits a line's count against what was expected into short, over and
 * rejected. Derived, never stored — received, rejected and expected are the
 * facts. See LineVarianceDto for what each part means.
 */
function lineVariance(
  expected: Prisma.Decimal,
  received: Prisma.Decimal,
  rejected: Prisma.Decimal,
  unitCost: Prisma.Decimal,
) {
  const zero     = new Prisma.Decimal(0)
  const accepted = received.sub(rejected)
  const short    = Prisma.Decimal.max(expected.sub(accepted), zero)
  // Over can never exceed rejected: validation keeps accepted ≤ outstanding,
  // so anything received beyond expected is already in the rejected column.
  const over     = Prisma.Decimal.max(received.sub(expected), zero)
  const refused  = rejected.sub(over)

  return {
    hasVariance: !short.isZero() || !over.isZero() || !refused.isZero(),
    short,
    over,
    refused,
    shortValue:   short.mul(unitCost),
    overValue:    over.mul(unitCost),
    refusedValue: refused.mul(unitCost),
  }
}

/**
 * The checks shared by create and update: the order can still take a
 * delivery, the branch and date are valid, and every order line has exactly
 * one count that respects what is outstanding. Returns the lines ready to
 * write. Everything here is checked in Decimal, because the form's checks are
 * for the person typing and a request can skip the form.
 */
async function validateCounts(
  po: PurchaseOrderWithDetail,
  input: UpdateReceivingReportInput,
): Promise<ReceivingReportResult<{ branchId: string; receivedAt: Date; lines: ReceivingReportLineInput[] }>> {
  if (!RECEIVABLE_STATUSES.includes(po.status)) {
    return {
      success: false,
      error:   `This order is ${statusText(po.status)} — only a sent or partially received order can take a delivery`,
      status:  409,
    }
  }

  const branch = await BranchRepository.findById(input.branchId)
  if (!branch || !branch.isActive) {
    return { success: false, error: 'Branch not found', status: 400 }
  }

  // Plain string comparison works because both sides are YYYY-MM-DD.
  if (input.receivedAt > todayIsoDate()) {
    return { success: false, error: 'The receiving date cannot be in the future', status: 400 }
  }

  // Exactly one count per order line: a line that did not arrive is a 0,
  // not a missing entry, so the report always says something about every
  // line on the order.
  const counted = new Set(input.items.map(item => item.purchaseOrderItemId))
  if (counted.size !== input.items.length) {
    return { success: false, error: 'A line was counted twice', status: 400 }
  }
  if (counted.size !== po.items.length) {
    return { success: false, error: 'Every line on the order needs a count — use 0 for anything that did not arrive', status: 400 }
  }

  // Outstanding comes from APPROVED reports only, so a draft being edited
  // never counts against itself.
  const balances = new Map((await lineBalances(po)).map(line => [line.item.id, line]))
  const lines: ReceivingReportLineInput[] = []

  for (const item of input.items) {
    const balance = balances.get(item.purchaseOrderItemId)
    if (!balance) {
      return { success: false, error: 'A line does not belong to this order', status: 400 }
    }

    const { item: poItem, outstanding } = balance
    const received = toDecimal(item.receivedQuantity)
    const rejected = toDecimal(item.rejectedQuantity)
    const name = poItem.material.name

    if (rejected.greaterThan(received)) {
      return { success: false, error: `${name}: rejected cannot be more than received`, status: 400 }
    }
    if (received.sub(rejected).greaterThan(outstanding)) {
      return {
        success: false,
        error:   `${name}: only ${outstanding.toString()} ${poItem.material.unit.abbreviation} is outstanding — enter the extra as rejected`,
        status:  400,
      }
    }
    // Whoever refused goods at the door says why — spoiled, wrong item, or
    // more than was ordered (over-delivery is entered as rejected too). A short
    // line needs no note: the shortfall stays outstanding, nothing is lost.
    // The schema trims notes, so whitespace-only arrives as ''.
    if (!rejected.isZero() && !item.notes) {
      return { success: false, error: `${name}: a rejected quantity needs a note saying why`, status: 400 }
    }

    lines.push({
      purchaseOrderItemId: poItem.id,
      materialId:          poItem.materialId,
      // The PO line's own quantity, not what is outstanding: the column says
      // what was ordered, and outstanding can be derived from earlier reports.
      orderedQuantity:     poItem.quantity,
      // Outstanding as of this save — what variance is measured against. It
      // stays true until approval: only one report per order can be open, so
      // no other approval can move outstanding while this one is counted.
      expectedQuantity:    outstanding,
      receivedQuantity:    received,
      rejectedQuantity:    rejected,
      // Copied, never typed: accounting approved the PO at this price.
      unitCost:            poItem.unitCost,
      notes:               item.notes ?? null,
    })
  }

  if (lines.every(line => line.receivedQuantity.isZero())) {
    return { success: false, error: 'Nothing was received on any line', status: 400 }
  }

  return {
    success: true,
    data: {
      branchId:   branch.id,
      // Midnight UTC of the chosen date, the same as a purchase request's
      // neededBy, so .slice(0, 10) on the ISO string reads it back unchanged.
      receivedAt: new Date(input.receivedAt),
      lines,
    },
  }
}

export const ReceivingReportService = {
  /**
   * No viewer scoping, like purchase orders: a delivery belongs to the
   * organisation, and every role allowed on /procurement/receiving needs the
   * whole list.
   */
  async list(filters: ReceivingReportListFilters = {}) {
    const { rows, total } = await ReceivingReportRepository.findMany(filters)
    const ids             = rows.map(rr => rr.id)
    const [varianceLines, acceptedValues] = await Promise.all([
      ReceivingReportRepository.varianceLineCounts(ids),
      ReceivingReportRepository.acceptedValues(ids),
    ])

    return {
      receivingReports: rows.map<ReceivingReportSummaryDto>(rr => ({
        id:              rr.id,
        rrNumber:        rr.rrNumber,
        status:          rr.status,
        purchaseOrderId: rr.purchaseOrder.id,
        poNumber:        rr.purchaseOrder.poNumber,
        supplierName:    rr.purchaseOrder.supplier?.name ?? null,
        branchName:      rr.branch.name,
        receivedByName:  rr.receivedBy.name,
        receivedAt:      rr.receivedAt.toISOString(),
        lineCount:       rr._count.items,
        varianceLineCount: varianceLines.get(rr.id) ?? 0,
        acceptedValue:     toDecimalString(acceptedValues.get(rr.id) ?? new Prisma.Decimal(0)),
      })),
      total,
    }
  },

  async getById(id: string): Promise<ReceivingReportResult<ReceivingReportDetailDto>> {
    const rr = await ReceivingReportRepository.findById(id)
    if (!rr) {
      return { success: false, error: 'Receiving report not found', status: 404 }
    }

    const zero      = new Prisma.Decimal(0)
    const decisions = await ApprovalRepository.findByReference('ReceivingReport', rr.id)

    // Accepted and its value are derived, never stored: received and rejected
    // are the facts, and storing a third column invites the three to disagree.
    let acceptedValue = zero
    let varianceLines = 0
    let shortTotal    = zero
    let overTotal     = zero
    let refusedTotal  = zero

    const lines = rr.items.map<ReceivingReportLineDto>(item => {
      const accepted = item.receivedQuantity.sub(item.rejectedQuantity)
      const value    = accepted.mul(item.unitCost)
      acceptedValue  = acceptedValue.add(value)

      // The stored figure, not today's outstanding: once this report is
      // approved its own acceptance is part of outstanding, and the live
      // number would show a matched delivery as over-delivered.
      const variance = lineVariance(item.expectedQuantity, item.receivedQuantity, item.rejectedQuantity, item.unitCost)
      if (variance.hasVariance) varianceLines += 1
      shortTotal   = shortTotal.add(variance.shortValue)
      overTotal    = overTotal.add(variance.overValue)
      refusedTotal = refusedTotal.add(variance.refusedValue)

      return {
        id:                  item.id,
        purchaseOrderItemId: item.purchaseOrderItemId,
        materialCode:        item.material.code,
        materialName:        item.material.name,
        unitAbbreviation:    item.material.unit.abbreviation,
        orderedQuantity:     toDecimalString(item.orderedQuantity),
        receivedQuantity:    toDecimalString(item.receivedQuantity),
        rejectedQuantity:    toDecimalString(item.rejectedQuantity),
        acceptedQuantity:    toDecimalString(accepted),
        unitCost:            toDecimalString(item.unitCost),
        acceptedValue:       toDecimalString(value),
        expectedQuantity:    toDecimalString(item.expectedQuantity),
        variance: {
          hasVariance:      variance.hasVariance,
          shortQuantity:    toDecimalString(variance.short),
          shortValue:       toDecimalString(variance.shortValue),
          overQuantity:     toDecimalString(variance.over),
          overValue:        toDecimalString(variance.overValue),
          rejectedQuantity: toDecimalString(variance.refused),
          rejectedValue:    toDecimalString(variance.refusedValue),
        },
        notes:               item.notes,
      }
    })

    return {
      success: true,
      data: {
        id:              rr.id,
        rrNumber:        rr.rrNumber,
        status:          rr.status,
        purchaseOrderId: rr.purchaseOrder.id,
        poNumber:        rr.purchaseOrder.poNumber,
        poStatus:        rr.purchaseOrder.status,
        supplierName:    rr.purchaseOrder.supplier?.name ?? null,
        branchId:        rr.branch.id,
        branchName:      rr.branch.name,
        receivedById:    rr.receivedBy.id,
        receivedByName:  rr.receivedBy.name,
        receivedAt:      rr.receivedAt.toISOString(),
        notes:           rr.notes,
        createdAt:       rr.createdAt.toISOString(),
        acceptedValue:   toDecimalString(acceptedValue),
        variance: {
          lineCount:     varianceLines,
          shortValue:    toDecimalString(shortTotal),
          overValue:     toDecimalString(overTotal),
          rejectedValue: toDecimalString(refusedTotal),
        },
        lines,
        decisions: decisions.map(decision => ({
          id:           decision.id,
          decision:     decision.decision,
          remarks:      decision.remarks,
          approverName: decision.approver.name,
          decidedAt:    decision.decidedAt.toISOString(),
        })),
      },
    }
  },

  /** Everything the "Receive delivery" page needs, in one call. */
  async getForm(purchaseOrderId: string): Promise<ReceivingReportResult<ReceivingFormDto>> {
    const po = await PurchaseOrderRepository.findById(purchaseOrderId)
    if (!po) {
      return { success: false, error: 'Purchase order not found', status: 404 }
    }

    const [balances, openReport, branches] = await Promise.all([
      lineBalances(po),
      ReceivingReportRepository.findOpenByPurchaseOrder(po.id),
      BranchRepository.findAllActive(),
    ])

    return {
      success: true,
      data: {
        purchaseOrderId: po.id,
        poNumber:        po.poNumber,
        status:          po.status,
        supplierName:    po.supplier?.name ?? null,
        receivable:
          RECEIVABLE_STATUSES.includes(po.status) &&
          balances.some(line => line.outstanding.greaterThan(0)),
        openReport,
        branches,
        lines: balances.map(({ item, alreadyReceived, outstanding }) => ({
          purchaseOrderItemId: item.id,
          materialCode:        item.material.code,
          materialName:        item.material.name,
          unitAbbreviation:    item.material.unit.abbreviation,
          orderedQuantity:     toDecimalString(item.quantity),
          alreadyReceived:     toDecimalString(alreadyReceived),
          outstanding:         toDecimalString(outstanding),
          unitCost:            toDecimalString(item.unitCost),
        })),
      },
    }
  },

  /**
   * Records a delivery as a DRAFT report. Moves no stock and does not touch
   * the order's status: both happen only when accounting approves (Task 4).
   * The counts are checked by validateCounts.
   */
  async create(
    input: CreateReceivingReportInput,
    viewer: Viewer,
  ): Promise<ReceivingReportResult<{ id: string; rrNumber: string }>> {
    // The same roles middleware allows on /api/receiving-reports. Repeated
    // here so the rule holds wherever the service is called from.
    if (!canReceive(viewer.role)) {
      return { success: false, error: 'Only procurement can record a delivery', status: 403 }
    }

    const po = await PurchaseOrderRepository.findById(input.purchaseOrderId)
    if (!po) {
      return { success: false, error: 'Purchase order not found', status: 404 }
    }

    // A check-then-insert, so two people saving at the same instant could both
    // pass it. Accepted: stock only moves on approval, and Task 4 re-checks the
    // outstanding quantity under a lock there.
    const open = await ReceivingReportRepository.findOpenByPurchaseOrder(po.id)
    if (open) {
      return {
        success: false,
        error:   `${open.rrNumber} is already open on this order — finish or correct it first`,
        status:  409,
      }
    }

    const checked = await validateCounts(po, input)
    if (!checked.success) return checked

    const created = await ReceivingReportRepository.create({
      purchaseOrderId: po.id,
      branchId:        checked.data.branchId,
      receivedById:    viewer.userId,
      receivedAt:      checked.data.receivedAt,
      notes:           input.notes ?? null,
      lines:           checked.data.lines,
    })

    return { success: true, data: created }
  },

  /**
   * Corrects a DRAFT report's counts, branch, date and notes. The order and
   * the copied prices cannot change.
   *
   * Whoever saves becomes the receiver, as on create. Otherwise an ADMIN could
   * rewrite someone else's counts and then approve them as if they were not
   * their own work.
   */
  async update(
    id: string,
    input: UpdateReceivingReportInput,
    viewer: Viewer,
  ): Promise<ReceivingReportResult<{ id: string; rrNumber: string }>> {
    if (!canReceive(viewer.role)) {
      return { success: false, error: 'Only procurement can edit a receiving report', status: 403 }
    }

    const rr = await ReceivingReportRepository.findById(id)
    if (!rr) {
      return { success: false, error: 'Receiving report not found', status: 404 }
    }

    if (rr.status !== RRStatus.DRAFT) {
      return {
        success: false,
        error:   `This report is ${rr.status.replace(/_/g, ' ').toLowerCase()} and can no longer be edited`,
        status:  409,
      }
    }

    const po = await PurchaseOrderRepository.findById(rr.purchaseOrderId)
    if (!po) {
      return { success: false, error: 'Purchase order not found', status: 404 }
    }

    const checked = await validateCounts(po, input)
    if (!checked.success) return checked

    const updated = await ReceivingReportRepository.updateDraft({
      id,
      branchId:     checked.data.branchId,
      receivedById: viewer.userId,
      receivedAt:   checked.data.receivedAt,
      notes:        input.notes ?? null,
      lines:        checked.data.lines,
    })
    if (!updated) {
      return { success: false, error: 'This report changed while you were editing it — reload and try again', status: 409 }
    }

    return { success: true, data: updated }
  },

  /**
   * DRAFT → PENDING_APPROVAL. Procurement only, like recording and editing.
   *
   * The saved counts go through validateCounts again first. A draft can have
   * been saved under an earlier rule (a rejected quantity without a note
   * predates subtask 2.4), or its branch deactivated since; accounting should
   * never be asked to approve a report the form would refuse today.
   */
  async submit(id: string, viewer: Viewer): Promise<ReceivingReportResult<{ id: string; rrNumber: string }>> {
    if (!canReceive(viewer.role)) {
      return { success: false, error: 'Only procurement can submit a receiving report', status: 403 }
    }

    const rr = await ReceivingReportRepository.findById(id)
    if (!rr) {
      return { success: false, error: 'Receiving report not found', status: 404 }
    }

    if (rr.status !== RRStatus.DRAFT) {
      return {
        success: false,
        error:   `This report is already ${rr.status.replace(/_/g, ' ').toLowerCase()} and cannot be submitted again`,
        status:  409,
      }
    }

    const po = await PurchaseOrderRepository.findById(rr.purchaseOrderId)
    if (!po) {
      return { success: false, error: 'Purchase order not found', status: 404 }
    }

    const checked = await validateCounts(po, {
      branchId:   rr.branchId,
      receivedAt: rr.receivedAt.toISOString().slice(0, 10),
      notes:      rr.notes,
      items:      rr.items.map(item => ({
        purchaseOrderItemId: item.purchaseOrderItemId,
        receivedQuantity:    item.receivedQuantity.toString(),
        rejectedQuantity:    item.rejectedQuantity.toString(),
        notes:               item.notes,
      })),
    })
    if (!checked.success) {
      return { ...checked, error: `${checked.error}. Edit the draft and save it, then submit.` }
    }

    const submitted = await ReceivingReportRepository.submit(id)
    if (!submitted) {
      return { success: false, error: 'This report changed while you were submitting it — reload and try again', status: 409 }
    }

    return { success: true, data: submitted }
  },

  /**
   * PENDING_APPROVAL → APPROVED | REJECTED. Called from POST /api/approvals,
   * which middleware already restricts to ACCOUNTING and ADMIN.
   *
   * The counter cannot decide their own count, ADMIN included. receivedById is
   * whoever last saved the draft and cannot change once it is submitted, so
   * this read cannot go stale.
   */
  async applyDecision(
    id: string,
    viewer: Viewer,
    decision: 'APPROVED' | 'REJECTED',
    remarks: string | null,
  ): Promise<ReceivingReportResult<{ id: string; rrNumber: string }>> {
    const rr = await ReceivingReportRepository.findById(id)
    if (!rr) {
      return { success: false, error: 'Receiving report not found', status: 404 }
    }

    if (rr.receivedById === viewer.userId) {
      return {
        success: false,
        error:   'You counted this delivery, so someone else has to decide it',
        status:  403,
      }
    }

    if (rr.status !== RRStatus.PENDING_APPROVAL) {
      return {
        success: false,
        error:   `This report is ${rr.status.replace(/_/g, ' ').toLowerCase()} and is no longer awaiting a decision`,
        status:  409,
      }
    }

    if (decision === 'REJECTED' && (remarks === null || remarks.trim() === '')) {
      return { success: false, error: 'Give a reason when rejecting', status: 400 }
    }

    const decided = await ReceivingReportRepository.decide({ id, approverId: viewer.userId, decision, remarks })
    if (!decided) {
      return { success: false, error: 'This report was decided by someone else just now', status: 409 }
    }

    return { success: true, data: decided }
  },
}
