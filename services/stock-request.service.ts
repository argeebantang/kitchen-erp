import { BomKind, BranchType, Prisma, StockRequestStatus, TransferStatus } from '@prisma/client'
import { config } from '@/lib/config'
import { addDays, timeOfDayAt, todayIsoDate } from '@/lib/dates'
import { toDecimal, toDecimalString } from '@/lib/decimal'
import { trimDecimal } from '@/lib/format'
import { getNotificationQueue, STOCK_REQUEST_DECIDED, STOCK_REQUEST_SUBMITTED, type StockRequestJob } from '@/lib/queue'
import { BomRepository } from '@/repositories/bom.repository'
import { BranchRepository } from '@/repositories/branch.repository'
import { FinishedGoodRepository } from '@/repositories/finished-good.repository'
import { FinishedGoodStockRepository } from '@/repositories/finished-good-stock.repository'
import { StockRequestRepository, type StockRequestWithDetail } from '@/repositories/stock-request.repository'

/**
 * Branch stock requests (Week 9 Task 10, docs/2026-11-21-week9-stock-requests.md):
 * an outlet asks any kitchen for finished goods by a date. No approval — the
 * kitchen plans it (cutting a line needs a reason) or declines it (reason),
 * sends a delivery from it, and the delivery's receipt fulfils it.
 */

/** Lines on one request — a day's order, not a stock count. */
export const MAX_REQUEST_LINES = 30
/** Longest note the outlet or the kitchen may write. */
export const REQUEST_NOTE_MAX = 1000

/** The roles that answer requests: the kitchen (Production Managers cover every kitchen) and admins. */
const KITCHEN_ROLES = ['ADMIN', 'PRODUCTION_MANAGER']

export type StockRequestViewer = { userId: string; role: string }

export type StockRequestResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status: number }

export type StockRequestLineDto = {
  itemId: string
  finishedGoodId: string
  finishedGoodCode: string
  finishedGoodName: string
  unitAbbreviation: string
  /** Asked for. */
  quantity: string
  /** What the kitchen will send; null until PLANNED (and for a decline). */
  plannedQuantity: string | null
  /** What arrived on its delivery; null until fulfilled. */
  received: string | null
}

export type StockRequestSummaryDto = {
  id: string
  requestNumber: string
  status: StockRequestStatus
  branch: { id: string; name: string; code: string }
  kitchen: { id: string; name: string; code: string }
  /** YYYY-MM-DD. */
  neededOn: string
  late: boolean
  submittedByName: string
  notes: string | null
  decidedByName: string | null
  decidedAt: string | null
  kitchenNote: string | null
  createdAt: string
  lines: StockRequestLineDto[]
  /** Deliveries sent from it, oldest first (one at a time: a rejected one can be sent again). */
  transfers: { id: string; transferNumber: string; status: TransferStatus }[]
}

export type StockRequestDetailDto = StockRequestSummaryDto & {
  /** SUBMITTED and the viewer is the kitchen: may plan or decline. */
  canDecide: boolean
  /** PLANNED, the viewer is the kitchen and no delivery is open: may send one. */
  canSend: boolean
}

/** What the new-request form offers. */
export type StockRequestFormDto = {
  /** The outlet a branch manager runs; every active outlet for an ADMIN. */
  outlets: { id: string; name: string }[]
  kitchens: { id: string; name: string }[]
  finishedGoods: { id: string; code: string; name: string; unitAbbreviation: string }[]
  /** YYYY-MM-DD, and the cut-off "HH:MM" — the form warns before a late request. */
  today: string
  cutoff: string
}

/** One finished good asked of a kitchen for one day, across its open requests (the kitchen's demand board). */
export type DemandLineDto = {
  finishedGoodId: string
  finishedGoodName: string
  unitAbbreviation: string
  /** Σ planned for PLANNED requests, Σ asked for SUBMITTED ones. */
  total: string
  /** Of which still SUBMITTED (not yet answered). */
  unanswered: string
  outlets: { requestId: string; requestNumber: string; branchName: string; quantity: string; status: StockRequestStatus; late: boolean }[]
  /** Batches of the active recipe that cover the total, rounded up; null without a recipe. */
  batches: number | null
  batchSize: string | null
}

export type DemandDayDto = { neededOn: string; kitchen: { id: string; name: string }; lines: DemandLineDto[] }

export type CreateStockRequestInput = {
  branchId: string
  kitchenId: string
  neededOn: string
  notes?: string | null
  lines: { finishedGoodId: string; quantity: string }[]
}

export const STOCK_REQUEST_STATUSES = Object.values(StockRequestStatus)

export function isStockRequestStatus(value: string): value is StockRequestStatus {
  return STOCK_REQUEST_STATUSES.some(status => status === value)
}

/** Still the kitchen's to act on. */
export const OPEN_REQUEST_STATUSES: StockRequestStatus[] = [StockRequestStatus.SUBMITTED, StockRequestStatus.PLANNED]

const zero = new Prisma.Decimal(0)

/** Midnight UTC of a business date — how neededOn is stored, like ProductionOrder.plannedDate. */
function dateValue(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`)
}

/**
 * Late (S-3): submitted at or after the cut-off on the day before it is
 * needed, or on the day itself. Allowed — the kitchen sees the flag.
 */
export function isLate(neededOn: string, now: Date, cutoff: string): boolean {
  const today = todayIsoDate()
  const dayBefore = addDays(neededOn, -1)
  if (today > dayBefore) return true
  return today === dayBefore && timeOfDayAt(now) >= cutoff
}

/**
 * Received per finished good on a request's delivery, once received: the
 * TRANSFER (+) rows at the outlet. Null when no delivery has been received.
 */
async function receivedByGood(request: StockRequestWithDetail): Promise<Map<string, Prisma.Decimal> | null> {
  const received = request.transfers.find(transfer => transfer.status === TransferStatus.RECEIVED)
  if (!received) return null
  const movements = await FinishedGoodStockRepository.findMovementsByReference('StockTransfer', received.id)
  const byGood = new Map<string, Prisma.Decimal>()
  for (const movement of movements) {
    if (!movement.quantity.greaterThan(0)) continue
    const goodId = movement.lot.finishedGood.id
    byGood.set(goodId, (byGood.get(goodId) ?? zero).add(movement.quantity))
  }
  return byGood
}

function toSummary(request: StockRequestWithDetail, received: Map<string, Prisma.Decimal> | null): StockRequestSummaryDto {
  return {
    id:              request.id,
    requestNumber:   request.requestNumber,
    status:          request.status,
    branch:          request.branch,
    kitchen:         request.kitchen,
    neededOn:        request.neededOn.toISOString().slice(0, 10),
    late:            request.late,
    submittedByName: request.submittedBy.name,
    notes:           request.notes,
    decidedByName:   request.decidedBy?.name ?? null,
    decidedAt:       request.decidedAt?.toISOString() ?? null,
    kitchenNote:     request.kitchenNote,
    createdAt:       request.createdAt.toISOString(),
    lines: request.items.map(item => ({
      itemId:           item.id,
      finishedGoodId:   item.finishedGood.id,
      finishedGoodCode: item.finishedGood.code,
      finishedGoodName: item.finishedGood.name,
      unitAbbreviation: item.finishedGood.unit.abbreviation,
      quantity:         toDecimalString(item.quantity),
      plannedQuantity:  item.plannedQuantity === null ? null : toDecimalString(item.plannedQuantity),
      received:         received === null ? null : toDecimalString(received.get(item.finishedGood.id) ?? zero),
    })),
    transfers: request.transfers.map(t => ({ id: t.id, transferNumber: t.transferNumber, status: t.status })),
  }
}

function isKitchen(viewer: StockRequestViewer): boolean {
  return KITCHEN_ROLES.includes(viewer.role)
}

/** A delivery from this request that is not rejected — at most one at a time. */
function openTransfer(request: StockRequestWithDetail) {
  return request.transfers.find(transfer => transfer.status !== TransferStatus.REJECTED) ?? null
}

/**
 * The outlet a branch manager may see requests for — the one they run (read
 * from Branch.managerId, never the token). `undefined` = every outlet (the
 * kitchen, admins); `null` = they run none.
 */
async function viewerScope(viewer: StockRequestViewer): Promise<{ id: string; name: string } | null | undefined> {
  if (viewer.role !== 'BRANCH_MANAGER') return undefined
  return BranchRepository.findManagedBy(viewer.userId)
}

/** Queued after the change has committed; a queue outage is logged, never surfaced. */
async function enqueue(jobName: string, stockRequestId: string): Promise<void> {
  try {
    await getNotificationQueue().add(jobName, { stockRequestId } satisfies StockRequestJob)
  } catch (err) {
    console.error(`[StockRequestService] could not enqueue ${jobName}`, err)
  }
}

export const StockRequestService = {
  async getForm(viewer: StockRequestViewer): Promise<StockRequestFormDto> {
    const [branches, kitchens, { rows: goods }, managed] = await Promise.all([
      BranchRepository.findAllActiveWithType(),
      BranchRepository.findActiveKitchens(),
      FinishedGoodRepository.findMany({ take: 100 }),
      viewer.role === 'BRANCH_MANAGER' ? BranchRepository.findManagedBy(viewer.userId) : null,
    ])
    const outlets = branches.filter(branch => branch.type === BranchType.OUTLET)
    return {
      outlets: (viewer.role === 'ADMIN' ? outlets : outlets.filter(branch => branch.id === managed?.id))
        .map(branch => ({ id: branch.id, name: branch.name })),
      kitchens,
      finishedGoods: goods.filter(good => good.isActive)
        .map(good => ({ id: good.id, code: good.code, name: good.name, unitAbbreviation: good.unit.abbreviation })),
      today:  todayIsoDate(),
      cutoff: config.stockRequestCutoff,
    }
  },

  /**
   * Submits a request (S-2, S-3): from an active outlet the viewer runs (any,
   * for an ADMIN), to an active kitchen, needed today or later, 1–30 lines,
   * one per active good, each > 0. Late is fixed now. No approval: the
   * kitchen is told.
   */
  async create(input: CreateStockRequestInput, viewer: StockRequestViewer): Promise<StockRequestResult<{ id: string; requestNumber: string; late: boolean }>> {
    if (viewer.role !== 'ADMIN' && viewer.role !== 'BRANCH_MANAGER') {
      return { success: false, error: 'Only an outlet\'s manager, or an admin, requests stock', status: 403 }
    }
    if (viewer.role === 'BRANCH_MANAGER') {
      const managed = await BranchRepository.findManagedBy(viewer.userId)
      if (!managed || managed.id !== input.branchId) return { success: false, error: 'Outlet not found', status: 404 }
    }
    const [outlet, kitchen] = await Promise.all([BranchRepository.findById(input.branchId), BranchRepository.findById(input.kitchenId)])
    if (!outlet || !outlet.isActive) return { success: false, error: 'Outlet not found', status: 400 }
    if (outlet.type !== BranchType.OUTLET) {
      return { success: false, error: `${outlet.name} is a kitchen — stock requests come from an outlet`, status: 400 }
    }
    if (!kitchen || !kitchen.isActive) return { success: false, error: 'Kitchen not found', status: 400 }
    if (kitchen.type !== BranchType.COMMISSARY) {
      return { success: false, error: `${kitchen.name} is an outlet — ask a central kitchen`, status: 400 }
    }
    // Plain string comparison works because both sides are YYYY-MM-DD.
    if (input.neededOn < todayIsoDate()) {
      return { success: false, error: 'The day it is needed cannot be in the past', status: 400 }
    }

    if (input.lines.length === 0) return { success: false, error: 'Add at least one finished good', status: 400 }
    if (input.lines.length > MAX_REQUEST_LINES) {
      return { success: false, error: `A request has at most ${MAX_REQUEST_LINES} lines`, status: 400 }
    }
    const ids = input.lines.map(line => line.finishedGoodId)
    if (new Set(ids).size !== ids.length) {
      return { success: false, error: 'Each finished good may appear on one line only — add the quantities together', status: 400 }
    }
    const items: { finishedGoodId: string; quantity: Prisma.Decimal }[] = []
    for (const line of input.lines) {
      const good = await FinishedGoodRepository.findById(line.finishedGoodId)
      if (!good || !good.isActive) return { success: false, error: 'Finished good not found', status: 400 }
      const quantity = toDecimal(line.quantity)
      if (quantity.lessThanOrEqualTo(0)) {
        return { success: false, error: `${good.name}: the quantity must be greater than zero`, status: 400 }
      }
      items.push({ finishedGoodId: good.id, quantity })
    }

    const late = isLate(input.neededOn, new Date(), config.stockRequestCutoff)
    const created = await StockRequestRepository.create({
      branchId:      outlet.id,
      kitchenId:     kitchen.id,
      neededOn:      dateValue(input.neededOn),
      late,
      submittedById: viewer.userId,
      notes:         input.notes?.trim() || null,
      items,
    })
    await enqueue(STOCK_REQUEST_SUBMITTED, created.id)
    return { success: true, data: { ...created, late } }
  },

  /** Soonest needed first. A branch manager sees only their own outlet's (S-9). */
  async list(viewer: StockRequestViewer, filters: { status?: StockRequestStatus; kitchenId?: string; branchId?: string } = {}): Promise<{
    requests: StockRequestSummaryDto[]
    total: number
    scopedTo: { id: string; name: string } | null
    managesNoBranch: boolean
  }> {
    const scope = await viewerScope(viewer)
    if (scope === null) return { requests: [], total: 0, scopedTo: null, managesNoBranch: true }
    const { rows, total } = await StockRequestRepository.findMany({
      statuses:  filters.status ? [filters.status] : undefined,
      kitchenId: filters.kitchenId,
      branchId:  scope?.id ?? filters.branchId,
    })
    return { requests: rows.map(row => toSummary(row, null)), total, scopedTo: scope ?? null, managesNoBranch: false }
  },

  /** One request, or 404 — also for a branch manager it does not concern. */
  async getById(id: string, viewer: StockRequestViewer): Promise<StockRequestResult<StockRequestDetailDto>> {
    const request = await StockRequestRepository.findById(id)
    if (!request) return { success: false, error: 'Stock request not found', status: 404 }
    const scope = await viewerScope(viewer)
    if (scope !== undefined && scope?.id !== request.branchId) {
      return { success: false, error: 'Stock request not found', status: 404 }
    }
    if (!isKitchen(viewer) && viewer.role !== 'BRANCH_MANAGER') {
      return { success: false, error: 'Stock request not found', status: 404 }
    }
    const received = await receivedByGood(request)
    return {
      success: true,
      data: {
        ...toSummary(request, received),
        canDecide: request.status === StockRequestStatus.SUBMITTED && isKitchen(viewer),
        canSend:   request.status === StockRequestStatus.PLANNED && isKitchen(viewer) && openTransfer(request) === null,
      },
    }
  },

  /**
   * The kitchen's demand board (S-5): open requests needed today or later,
   * per kitchen and day, each finished good totalled across the outlets —
   * planned quantities for PLANNED requests, asked for SUBMITTED ones — with
   * the batches of its active recipe that cover it, rounded up.
   */
  async demand(viewer: StockRequestViewer, kitchenId?: string): Promise<DemandDayDto[]> {
    if (!isKitchen(viewer)) return []
    const { rows } = await StockRequestRepository.findMany({
      statuses:   OPEN_REQUEST_STATUSES,
      kitchenId,
      neededFrom: dateValue(todayIsoDate()),
      take:       500,
    })

    const days = new Map<string, DemandDayDto>()
    const totals = new Map<string, { line: DemandLineDto; total: Prisma.Decimal; unanswered: Prisma.Decimal }>()
    for (const request of rows) {
      const neededOn = request.neededOn.toISOString().slice(0, 10)
      const dayKey = `${neededOn}|${request.kitchen.id}`
      let day = days.get(dayKey)
      if (!day) {
        day = { neededOn, kitchen: { id: request.kitchen.id, name: request.kitchen.name }, lines: [] }
        days.set(dayKey, day)
      }
      for (const item of request.items) {
        const quantity = request.status === StockRequestStatus.PLANNED ? (item.plannedQuantity ?? zero) : item.quantity
        if (!quantity.greaterThan(0)) continue
        const key = `${dayKey}|${item.finishedGood.id}`
        let entry = totals.get(key)
        if (!entry) {
          entry = {
            line: {
              finishedGoodId:   item.finishedGood.id,
              finishedGoodName: item.finishedGood.name,
              unitAbbreviation: item.finishedGood.unit.abbreviation,
              total: '0', unanswered: '0', outlets: [], batches: null, batchSize: null,
            },
            total: zero, unanswered: zero,
          }
          totals.set(key, entry)
          day.lines.push(entry.line)
        }
        entry.total = entry.total.add(quantity)
        if (request.status === StockRequestStatus.SUBMITTED) entry.unanswered = entry.unanswered.add(quantity)
        entry.line.outlets.push({
          requestId: request.id, requestNumber: request.requestNumber, branchName: request.branch.name,
          quantity: toDecimalString(quantity), status: request.status, late: request.late,
        })
      }
    }

    const boms = new Map<string, Prisma.Decimal | null>()
    for (const { line, total, unanswered } of totals.values()) {
      line.total = toDecimalString(total)
      line.unanswered = toDecimalString(unanswered)
      if (!boms.has(line.finishedGoodId)) {
        const bom = await BomRepository.findActiveByFinishedGood(line.finishedGoodId, BomKind.PRODUCTION)
        boms.set(line.finishedGoodId, bom?.batchSize ?? null)
      }
      const batchSize = boms.get(line.finishedGoodId) ?? null
      if (batchSize !== null && batchSize.greaterThan(0)) {
        line.batchSize = toDecimalString(batchSize)
        line.batches = Math.max(1, total.div(batchSize).ceil().toNumber())
      }
    }
    for (const day of days.values()) day.lines.sort((a, b) => a.finishedGoodName.localeCompare(b.finishedGoodName))
    return [...days.values()]
  },

  /**
   * The kitchen will send it (S-4): every line's planned quantity, 0 ≤ planned
   * ≤ asked; planning less than asked on any line needs a note (the outlet
   * sees it). Nothing planned at all is a decline. SUBMITTED only.
   */
  async plan(
    id: string,
    viewer: StockRequestViewer,
    input: { lines: { itemId: string; plannedQuantity: string }[]; note?: string | null },
  ): Promise<StockRequestResult<{ id: string; requestNumber: string; status: StockRequestStatus }>> {
    if (!isKitchen(viewer)) return { success: false, error: 'Only the kitchen plans stock requests', status: 403 }
    const request = await StockRequestRepository.findById(id)
    if (!request) return { success: false, error: 'Stock request not found', status: 404 }
    if (request.status !== StockRequestStatus.SUBMITTED) {
      return { success: false, error: `${request.requestNumber} is ${request.status.replace(/_/g, ' ').toLowerCase()} — it has already been answered`, status: 409 }
    }

    const given = new Map(input.lines.map(line => [line.itemId, line.plannedQuantity]))
    const planned = new Map<string, Prisma.Decimal>()
    let cut = false
    for (const item of request.items) {
      const value = given.get(item.id)
      if (value === undefined) {
        return { success: false, error: `Set how much ${item.finishedGood.name} the kitchen will send`, status: 400 }
      }
      const quantity = toDecimal(value)
      if (quantity.lessThan(0) || quantity.greaterThan(item.quantity)) {
        const unit = item.finishedGood.unit.abbreviation
        return {
          success: false,
          error:   `${item.finishedGood.name}: plan between 0 and the ${trimDecimal(toDecimalString(item.quantity))} ${unit} asked`,
          status:  400,
        }
      }
      if (quantity.lessThan(item.quantity)) cut = true
      planned.set(item.id, quantity)
    }
    if (given.size !== request.items.length) {
      return { success: false, error: 'A planned line is not on this request — reload and try again', status: 400 }
    }
    if ([...planned.values()].every(quantity => quantity.isZero())) {
      return { success: false, error: 'Nothing would be sent — decline the request instead, with the reason', status: 400 }
    }
    const note = input.note?.trim() || null
    if (cut && note === null) {
      return { success: false, error: 'Say why less than asked will be sent — the outlet sees it', status: 400 }
    }

    const done = await StockRequestRepository.plan({ id, deciderId: viewer.userId, note, planned })
    if (!done) return { success: false, error: 'This request was answered by someone else just now — reload', status: 409 }
    await enqueue(STOCK_REQUEST_DECIDED, id)
    return { success: true, data: { id, requestNumber: request.requestNumber, status: StockRequestStatus.PLANNED } }
  },

  /** The kitchen will not send it (S-4): a reason is required; final. SUBMITTED only. */
  async decline(id: string, viewer: StockRequestViewer, reason: string): Promise<StockRequestResult<{ id: string; requestNumber: string; status: StockRequestStatus }>> {
    if (!isKitchen(viewer)) return { success: false, error: 'Only the kitchen declines stock requests', status: 403 }
    const request = await StockRequestRepository.findById(id)
    if (!request) return { success: false, error: 'Stock request not found', status: 404 }
    if (request.status !== StockRequestStatus.SUBMITTED) {
      return { success: false, error: `${request.requestNumber} is ${request.status.replace(/_/g, ' ').toLowerCase()} — it has already been answered`, status: 409 }
    }
    const note = reason.trim()
    if (note === '') return { success: false, error: 'Give a reason — the outlet sees it', status: 400 }

    const done = await StockRequestRepository.decline({ id, deciderId: viewer.userId, note })
    if (!done) return { success: false, error: 'This request was answered by someone else just now — reload', status: 409 }
    await enqueue(STOCK_REQUEST_DECIDED, id)
    return { success: true, data: { id, requestNumber: request.requestNumber, status: StockRequestStatus.DECLINED } }
  },

  /**
   * What a delivery from this request must match (S-6): PLANNED, no other
   * delivery open, from its kitchen to its outlet. The transfer form starts
   * from the planned quantities; the lines may differ (the kitchen sends what
   * it has) — the receipt decides fulfilled or partly.
   */
  async checkSendable(id: string, fromBranchId: string, toBranchId: string): Promise<StockRequestResult<{ requestNumber: string }>> {
    const request = await StockRequestRepository.findById(id)
    if (!request) return { success: false, error: 'Stock request not found', status: 400 }
    if (request.status !== StockRequestStatus.PLANNED) {
      return { success: false, error: `${request.requestNumber} is ${request.status.replace(/_/g, ' ').toLowerCase()} — only a planned request is sent`, status: 409 }
    }
    const open = openTransfer(request)
    if (open) return { success: false, error: `${request.requestNumber} is already being sent on ${open.transferNumber}`, status: 409 }
    if (request.kitchenId !== fromBranchId || request.branchId !== toBranchId) {
      return { success: false, error: `${request.requestNumber} is from ${request.kitchen.name} to ${request.branch.name}`, status: 400 }
    }
    return { success: true, data: { requestNumber: request.requestNumber } }
  },

  /** The transfer form's starting point for a request: from, to and the planned lines. */
  async sendPlan(id: string, viewer: StockRequestViewer): Promise<{
    requestId: string; requestNumber: string; fromBranchId: string; toBranchId: string
    lines: { finishedGoodId: string; quantity: string }[]
  } | null> {
    const found = await StockRequestService.getById(id, viewer)
    if (!found.success || !found.data.canSend) return null
    const request = found.data
    return {
      requestId:     request.id,
      requestNumber: request.requestNumber,
      fromBranchId:  request.kitchen.id,
      toBranchId:    request.branch.id,
      lines: request.lines
        .filter(line => line.plannedQuantity !== null && Number(line.plannedQuantity) > 0)
        .map(line => ({ finishedGoodId: line.finishedGoodId, quantity: line.plannedQuantity as string })),
    }
  },

  /**
   * Its delivery was received (S-7): FULFILLED when every line arrived in full
   * of what was asked, PARTLY_FULFILLED otherwise (a cut, a shortfall on the
   * road, or less sent). Called after the receipt has committed; a request no
   * longer PLANNED is left alone.
   */
  async onDeliveryReceived(stockRequestId: string): Promise<void> {
    const request = await StockRequestRepository.findById(stockRequestId)
    if (!request || request.status !== StockRequestStatus.PLANNED) return
    const received = await receivedByGood(request)
    if (received === null) return
    const full = request.items.every(item => (received.get(item.finishedGood.id) ?? zero).greaterThanOrEqualTo(item.quantity))
    await StockRequestRepository.fulfil(request.id, full ? StockRequestStatus.FULFILLED : StockRequestStatus.PARTLY_FULFILLED)
  },
}
