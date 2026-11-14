import { Prisma, Role } from '@prisma/client'
import { BUSINESS_TIME_ZONE, EXPIRY_SOON_HOURS, expiryFlag, formatTimeLeft } from '@/lib/dates'
import { formatPeso, formatQuantity, trimDecimal } from '@/lib/format'
import { publishNotificationsChanged } from '@/lib/realtime'
import { InventoryRepository } from '@/repositories/inventory.repository'
import { FinishedGoodStockRepository } from '@/repositories/finished-good-stock.repository'
import { CreateNotificationInput, NotificationRepository } from '@/repositories/notification.repository'
import { InventoryService, reorderAlerts } from '@/services/inventory.service'
import { PurchaseRequestRepository } from '@/repositories/purchase-request.repository'
import { ProductionOrderRepository } from '@/repositories/production-order.repository'
import { ConversionOrderRepository } from '@/repositories/conversion-order.repository'
import { WriteOffRepository } from '@/repositories/write-off.repository'
import { StockTransferRepository, type StockTransferWithDetail } from '@/repositories/stock-transfer.repository'
import { BranchRepository } from '@/repositories/branch.repository'
import { reasonLabel } from '@/services/write-off.service'
import { transferVarianceReasonLabel } from '@/lib/transfer-variance'
import { EndOfDayService } from '@/services/end-of-day.service'
import { ApprovalRepository } from '@/repositories/approval.repository'
import { ProductionOrderService } from '@/services/production-order.service'
import { UserRepository } from '@/repositories/user.repository'

/** Roles that can decide a purchase request or production order, and therefore need to know one is waiting. */
const APPROVER_ROLES: Role[] = [Role.ACCOUNTING, Role.ADMIN]

/** Roles that raise purchase requests, and therefore need to know what to reorder. */
const ORDERING_ROLES: Role[] = [Role.PROCUREMENT_MANAGER, Role.ADMIN]

/** Roles that act on lots near expiry — sell, convert or write them off (Week 7 Task 3, X3). */
const EXPIRY_ROLES: Role[] = [Role.PRODUCTION_MANAGER, Role.ADMIN]

/** Roles that close the day: the kitchen, and accounting for the money side (Week 7 Task 4, E4). */
const END_OF_DAY_ROLES: Role[] = [Role.PRODUCTION_MANAGER, Role.ACCOUNTING, Role.ADMIN]

/** How many materials the low-stock summary names before "+N more". */
const SUMMARY_NAMES = 5

/** How many notifications the bell shows. */
const LATEST = 15

/**
 * Where each kind of notification leads, keyed by referenceType. The daily
 * jobs' referenceId is a date, not a document, so their pages ignore it.
 * A type missing here shows without a link.
 */
const REFERENCE_PAGES: Record<string, (referenceId: string) => string> = {
  PurchaseRequest:     id => `/procurement/requests/${id}`,
  LowStockCheck:       () => '/inventory/stock',
  ExpiryCheck:         () => '/inventory/finished-goods',
  // Unlike the other daily jobs, the date matters: the bell opens that day.
  EndOfDaySummary:     date => `/inventory/end-of-day?date=${date}`,
  StockReconciliation: () => '/inventory/ledger',
  ProductionOrder:     id => `/production/orders/${id}`,
  // Procurement cannot open production orders; their link is the purchase
  // request pre-filled with the shortfall (Week 5 Task 4).
  ProductionOrderShortfall: id => `/procurement/requests/new?productionOrder=${id}`,
  ConversionOrder:     id => `/production/conversions/${id}`,
  WriteOff:            id => `/inventory/write-offs/${id}`,
  StockTransfer:       id => `/inventory/transfers/${id}`,
}

export type NotificationDto = {
  id: string
  type: string
  title: string
  body: string | null
  href: string | null
  read: boolean
  createdAt: string
}

export type NotificationListDto = {
  unreadCount: number
  notifications: NotificationDto[]
}

/**
 * Tell these users' open browsers to reload their notifications
 * (lib/realtime.ts). Never fails the caller — like the queue, Redis being down
 * must not undo a write that already happened; the bell catches up the next
 * time it connects.
 */
async function push(userIds: string[]): Promise<void> {
  try {
    await publishNotificationsChanged(userIds)
  } catch (err) {
    console.error('[notifications] push failed; the database change stands', err)
  }
}

/** Every notification write goes through here: insert the rows, then push. */
async function createAndPush(inputs: CreateNotificationInput[]): Promise<number> {
  const count = await NotificationRepository.createMany(inputs)
  if (count > 0) await push(inputs.map(input => input.userId))
  return count
}

export const NotificationService = {
  /**
   * Mark one of the user's notifications read, or all of them. Only that
   * user's unread rows can match, so an id belonging to someone else changes
   * nothing. Pushed, so the user's other open tabs update too. Returns how
   * many changed (0 when already read — not an error).
   */
  async markRead(userId: string, target: { id: string } | { all: true }): Promise<number> {
    const count = await NotificationRepository.markRead(userId, 'id' in target ? target.id : null)
    if (count > 0) await push([userId])
    return count
  },

  /** The bell: the user's latest notifications, each with its link, and the unread count. */
  async listForUser(userId: string): Promise<NotificationListDto> {
    const { rows, unreadCount } = await NotificationRepository.findLatestForUser(userId, LATEST)

    return {
      unreadCount,
      notifications: rows.map(row => {
        const page = row.referenceType ? REFERENCE_PAGES[row.referenceType] : undefined
        return {
          id:        row.id,
          type:      row.type,
          title:     row.title,
          body:      row.body,
          href:      page && row.referenceId ? page(row.referenceId) : null,
          read:      row.readAt !== null,
          createdAt: row.createdAt.toISOString(),
        }
      }),
    }
  },

  /** Returns how many notifications were written. */
  async notifyPurchaseRequestSubmitted(purchaseRequestId: string): Promise<number> {
    const pr = await PurchaseRequestRepository.findById(purchaseRequestId)

    // The job carries only an id, so the request may have been deleted between
    // enqueue and processing. Not an error — there is simply nothing to say.
    if (!pr) return 0

    const approvers = await UserRepository.findByRoles(APPROVER_ROLES)

    // Nobody is told to approve their own request. An ADMIN who raised it is an
    // approver by role but cannot decide this particular one.
    const recipients = approvers.filter(user => user.id !== pr.requestedById)

    return createAndPush(
      recipients.map(user => ({
        userId:        user.id,
        type:          'PR_SUBMITTED',
        title:         `${pr.prNumber} is waiting for approval`,
        body:          `${pr.requester.name} submitted ${pr.items.length} line${
          pr.items.length === 1 ? '' : 's'
        } for approval.`,
        referenceType: 'PurchaseRequest',
        referenceId:   pr.id,
      })),
    )
  },

  /**
   * The daily low-stock summary: one notification per ordering user, built
   * from the stock map's own reorder alerts so the two cannot disagree.
   * Returns how many notifications were written.
   *
   * `date` (YYYY-MM-DD, Manila) is the referenceId, so a retry or a second run
   * on the same day skips everyone already told. Nothing to reorder → nothing
   * sent. Two runs at the very same moment could both pass the check; the
   * scheduler starts one job per day, so that is not guarded further.
   */
  async notifyLowStock(date: string): Promise<number> {
    const alerts = reorderAlerts(await InventoryService.stockMap())
    if (alerts.length === 0) return 0

    const [users, alreadyTold] = await Promise.all([
      UserRepository.findByRoles(ORDERING_ROLES),
      NotificationRepository.userIdsWithReference('LowStockCheck', date),
    ])
    const recipients = users.filter(user => !alreadyTold.has(user.id))

    const out = alerts.filter(alert => alert.status === 'OUT').length
    const low = alerts.length - out
    // Alerts come worst first, so the names are the out-of-stock ones. The
    // branch is only worth naming when there is more than one.
    const severalBranches = new Set(alerts.map(alert => alert.branchId)).size > 1
    const names = alerts
      .slice(0, SUMMARY_NAMES)
      .map(alert => (severalBranches ? `${alert.materialName} (${alert.branchName})` : alert.materialName))
    const more = alerts.length - names.length

    return createAndPush(
      recipients.map(user => ({
        userId:        user.id,
        type:          'LOW_STOCK',
        title:         `${alerts.length} material${alerts.length === 1 ? ' needs' : 's need'} reordering`,
        body:          `${out} out of stock, ${low} low: ${names.join(', ')}${more > 0 ? `, +${more} more` : ''}.`,
        referenceType: 'LowStockCheck',
        referenceId:   date,
      })),
    )
  },

  /**
   * The morning expiry check (Week 7 Task 3, X3): every lot with stock that
   * is expired, or expires within 24 / 48 h, in one notification per
   * production manager and admin — what to sell, convert or write off first.
   * Most urgent first, naming the first few lots, with the value at stake at
   * each lot's cost. Once per person per day (the date is the referenceId);
   * nothing when no lot is flagged. One clock for the whole run.
   */
  async notifyExpiringLots(date: string): Promise<{ lots: number; written: number }> {
    const now    = Date.now()
    const levels = await FinishedGoodStockRepository.findExpiringBy(new Date(now + EXPIRY_SOON_HOURS * 60 * 60 * 1000))
    if (levels.length === 0) return { lots: 0, written: 0 }

    const [users, alreadyTold] = await Promise.all([
      UserRepository.findByRoles(EXPIRY_ROLES),
      NotificationRepository.userIdsWithReference('ExpiryCheck', date),
    ])
    const recipients = users.filter(user => !alreadyTold.has(user.id))

    const flagged = levels.flatMap(level => {
      const flag = expiryFlag(level.lot.expiresAt, now)
      return flag === null || flag.status === 'OK' ? [] : [{ level, flag }]
    })
    const count = (status: string) => flagged.filter(entry => entry.flag.status === status).length
    const expired = count('EXPIRED')
    const urgent  = count('WITHIN_24H')
    const soon    = count('WITHIN_48H')

    let worth = new Prisma.Decimal(0)
    for (const { level } of flagged) {
      const unitCost = level.lot.movements[0]?.unitCost ?? null
      if (unitCost !== null) worth = worth.add(level.quantity.mul(unitCost))
    }

    // Already soonest first, so expired lots lead. The branch is only worth
    // naming when there is more than one.
    const severalBranches = new Set(flagged.map(entry => entry.level.branch.name)).size > 1
    const names = flagged.slice(0, SUMMARY_NAMES).map(({ level, flag }) => {
      const when = flag.status === 'EXPIRED' ? 'expired' : `${formatTimeLeft(flag.minutesLeft)} left`
      return `${level.lot.lotNumber} ${level.lot.finishedGood.name} ${formatQuantity(level.quantity.toString())} ${level.lot.finishedGood.unit.abbreviation}`
        + (severalBranches ? ` at ${level.branch.name}` : '') + ` (${when})`
    })
    const more  = flagged.length - names.length
    const parts = [
      expired > 0 ? `${expired} expired` : null,
      urgent > 0 ? `${urgent} within 24 h` : null,
      soon > 0 ? `${soon} within 48 h` : null,
    ].filter(part => part !== null)

    const written = await createAndPush(recipients.map(user => ({
      userId:        user.id,
      type:          'EXPIRY_ALERT',
      title:         `${flagged.length} lot${flagged.length === 1 ? '' : 's'} to sell, convert or write off — ${parts.join(', ')}`,
      body:          `${names.join(', ')}${more > 0 ? `, +${more} more` : ''}. Worth ${formatPeso(worth.toString())} at cost.`,
      referenceType: 'ExpiryCheck',
      referenceId:   date,
    })))
    return { lots: flagged.length, written }
  },

  /**
   * The evening close (Week 7 Task 4, E4): the End of Day page's figures for
   * `date` — per finished good that moved, opening → closing and the flows
   * between; the pesos by flow; the closing value at cost; and any row that
   * does not reconcile — to every production manager, accountant and admin.
   * Once per person per day (the date is the referenceId); nothing on a day
   * with no finished-goods movement. Movements approved after the run are on
   * the page, not in the notification.
   */
  async notifyEndOfDay(date: string): Promise<{ movements: number; written: number }> {
    const day = await EndOfDayService.forDay(date, null, null)
    if (day.movementCount === 0) return { movements: 0, written: 0 }

    const [users, alreadyTold] = await Promise.all([
      UserRepository.findByRoles(END_OF_DAY_ROLES),
      NotificationRepository.userIdsWithReference('EndOfDaySummary', date),
    ])
    const recipients = users.filter(user => !alreadyTold.has(user.id))

    // "+18", "−10" (a true minus).
    const signed = (quantity: string) => {
      const shown = formatQuantity(quantity)
      return shown.startsWith('-') ? `−${shown.slice(1)}` : `+${shown}`
    }
    const flowNames = [
      ['produced', 'produced'], ['convertedIn', 'converted in'], ['convertedOut', 'converted out'],
      ['writtenOff', 'written off'], ['distributed', 'distributed'],
    ] as const
    const moved = day.rows.filter(row => row.movementCount > 0)
    const severalBranches = new Set(day.rows.map(row => row.branchName)).size > 1
    const goods = moved.slice(0, SUMMARY_NAMES).map(row => {
      const flows = flowNames
        .filter(([key]) => formatQuantity(row[key].quantity) !== '0')
        .map(([key, name]) => `${name} ${signed(row[key].quantity)}`)
      return `${row.finishedGoodName}${severalBranches ? ` at ${row.branchName}` : ''} `
        + `${formatQuantity(row.opening.quantity)} → ${formatQuantity(row.closing.quantity)} ${row.unitAbbreviation}`
        + (flows.length > 0 ? ` (${flows.join(', ')})` : '')
    })
    const more  = moved.length - goods.length
    const pesos = flowNames
      .filter(([key]) => formatPeso(day.totals[key]) !== '₱0.00')
      .map(([key, name]) => `${name} ${formatPeso(day.totals[key].replace(/^-/, ''))}`)
    const unreconciled = day.rows.filter(row => !row.balanced || row.matchesStock === false).length

    const label = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-PH', {
      timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
    })
    // A run for today (the 21:00 job) is a snapshot; a past day is complete.
    const asOf = day.isToday
      ? `As of ${new Date().toLocaleTimeString('en-PH', { timeZone: BUSINESS_TIME_ZONE, hour: 'numeric', minute: '2-digit' })}.`
      : null

    const written = await createAndPush(recipients.map(user => ({
      userId:        user.id,
      type:          'END_OF_DAY',
      title:         `End of day, ${label}: ${day.movementCount} movement${day.movementCount === 1 ? '' : 's'} — closing ${formatPeso(day.totals.closing)} at cost`
        + (unreconciled > 0 ? ` · ${unreconciled} row${unreconciled === 1 ? '' : 's'} not reconciling` : ''),
      body:          [
        `${goods.join('; ')}${more > 0 ? `; +${more} more` : ''}.`,
        pesos.length > 0 ? `At cost: ${pesos.join(', ')}.` : null,
        asOf,
      ].filter(part => part !== null).join(' '),
      referenceType: 'EndOfDaySummary',
      referenceId:   date,
    })))
    return { movements: day.movementCount, written }
  },

  /**
   * The daily ledger reconciliation: if any stock level disagrees with its
   * ledger total — materials, or finished-goods lots (Week 6 Task 2) — one
   * notification to each ADMIN naming them. Everything agreeing is the normal
   * case and sends nothing. Same per-day guard as the low-stock summary,
   * keyed by `date`.
   */
  async notifyStockMismatches(date: string): Promise<{ mismatches: number; written: number }> {
    const [materials, finishedGoods] = await Promise.all([
      InventoryRepository.mismatchedLevels(),
      FinishedGoodStockRepository.mismatchedLevels(),
    ])
    const mismatches = [
      ...materials.map(row => ({ ...row, name: row.materialName })),
      ...finishedGoods.map(row => ({ ...row, name: `${row.finishedGoodName} lot ${row.lotNumber}` })),
    ]
    if (mismatches.length === 0) return { mismatches: 0, written: 0 }

    const [admins, alreadyTold] = await Promise.all([
      UserRepository.findByRoles([Role.ADMIN]),
      NotificationRepository.userIdsWithReference('StockReconciliation', date),
    ])

    const named = mismatches.slice(0, SUMMARY_NAMES).map(row => {
      const unit = row.unitAbbreviation
      return `${row.name} at ${row.branchName}: ledger ${trimDecimal(row.ledgerTotal.toString())} ${unit}, `
        + `level ${trimDecimal(row.stockLevel.toString())} ${unit}`
    })
    const more = mismatches.length - named.length

    const written = await createAndPush(
      admins
        .filter(admin => !alreadyTold.has(admin.id))
        .map(admin => ({
          userId:        admin.id,
          type:          'STOCK_MISMATCH',
          title:         `Stock ledger disagrees with ${mismatches.length} stock level${mismatches.length === 1 ? '' : 's'}`,
          body:          `${named.join('; ')}${more > 0 ? `; +${more} more` : ''}. `
            + 'Something changed stock without writing both the ledger and the level — check the Stock Ledger for each.',
          referenceType: 'StockReconciliation',
          referenceId:   date,
        })),
    )
    return { mismatches: mismatches.length, written }
  },

  /**
   * A production order is waiting: tell everyone who can decide it except
   * whoever submitted it (Week 5 Task 5, D8). Returns how many were written.
   */
  async notifyProductionOrderSubmitted(productionOrderId: string): Promise<number> {
    const order = await ProductionOrderRepository.findById(productionOrderId)
    // Re-read when the job runs: gone, or already decided, means nothing to say.
    if (!order || order.status !== 'PENDING_APPROVAL') return 0

    const approvers  = await UserRepository.findByRoles(APPROVER_ROLES)
    const recipients = approvers.filter(user => user.id !== order.submittedBy?.id)

    return createAndPush(recipients.map(user => ({
      userId:        user.id,
      type:          'PRODUCTION_ORDER_SUBMITTED',
      title:         `${order.orderNumber} is waiting for approval`,
      body:          `${order.submittedBy?.name ?? 'Production'} submitted ${order.finishedGood.name} `
        + `${trimDecimal(order.plannedQty.toString())} ${order.bom.batchUnit.abbreviation} for ${order.plannedDate.toISOString().slice(0, 10)}.`,
      referenceType: 'ProductionOrder',
      referenceId:   order.id,
    })))
  },

  /**
   * A production order was decided: tell whoever submitted it, with the reason
   * on a rejection. On approval with shortages, also tell the ordering roles
   * which ingredients and how much — approval is when a shortage becomes real
   * (Task 5, D8). The approver is never told about their own decision.
   */
  async notifyProductionOrderDecided(productionOrderId: string): Promise<number> {
    const order = await ProductionOrderRepository.findById(productionOrderId)
    if (!order || (order.status !== 'APPROVED' && order.status !== 'REJECTED')) return 0

    const [latest] = await ApprovalRepository.findByReference('ProductionOrder', order.id)
    const approverId = latest?.approver.id ?? null
    const approved   = order.status === 'APPROVED'
    const inputs: CreateNotificationInput[] = []

    if (order.submittedBy && order.submittedBy.id !== approverId) {
      inputs.push({
        userId:        order.submittedBy.id,
        type:          approved ? 'PRODUCTION_ORDER_APPROVED' : 'PRODUCTION_ORDER_REJECTED',
        title:         `${order.orderNumber} was ${approved ? 'approved' : 'rejected'}`,
        body:          approved
          ? `${latest?.approver.name ?? 'Accounting'} approved ${order.finishedGood.name} for ${order.plannedDate.toISOString().slice(0, 10)}.`
          : `${latest?.approver.name ?? 'Accounting'}: ${latest?.remarks ?? 'no reason given'}`,
        referenceType: 'ProductionOrder',
        referenceId:   order.id,
      })
    }

    if (approved) {
      const detail = await ProductionOrderService.getById(order.id)
      const short  = detail.success
        ? detail.data.requirements.filter(line => line.stock !== null && !line.stock.enough)
        : []

      if (short.length > 0) {
        const named = short.slice(0, SUMMARY_NAMES)
          .map(line => `${line.materialName} ${trimDecimal(line.stock?.short ?? '0')} ${line.unitAbbreviation}`)
          .join(', ')
        const more  = short.length > SUMMARY_NAMES ? ` +${short.length - SUMMARY_NAMES} more` : ''
        const orderers = await UserRepository.findByRoles(ORDERING_ROLES)

        for (const user of orderers.filter(candidate => candidate.id !== approverId)) {
          inputs.push({
            userId:        user.id,
            type:          'PRODUCTION_SHORTFALL',
            title:         `${order.orderNumber} approved — short on ${short.length} ingredient${short.length === 1 ? '' : 's'}`,
            body:          `${order.branch.name}, ${order.plannedDate.toISOString().slice(0, 10)}: ${named}${more}.`,
            referenceType: 'ProductionOrderShortfall',
            referenceId:   order.id,
          })
        }
      }
    }

    return createAndPush(inputs)
  },

  /**
   * The kitchen reported a run done: tell everyone who can sign it off except
   * whoever reported it (Week 6 Task 2, D11). Re-reads the order — gone, or
   * already decided, means nothing to say.
   */
  async notifyCompletionReported(productionOrderId: string): Promise<number> {
    const order = await ProductionOrderRepository.findById(productionOrderId)
    if (!order || order.status !== 'PENDING_COMPLETION' || order.actualQty === null) return 0

    const actualQty  = order.actualQty
    const unit       = order.bom.batchUnit.abbreviation
    const percent    = actualQty.div(order.plannedQty).mul(100).toDecimalPlaces(1)
    const approvers  = await UserRepository.findByRoles(APPROVER_ROLES)
    const recipients = approvers.filter(user => user.id !== order.completedBy?.id)

    return createAndPush(recipients.map(user => ({
      userId:        user.id,
      type:          'PRODUCTION_COMPLETION_REPORTED',
      title:         `${order.orderNumber} is done — waiting for your approval`,
      body:          `${order.completedBy?.name ?? 'Production'} reported ${order.finishedGood.name} `
        + `${trimDecimal(actualQty.toString())} ${unit} of ${trimDecimal(order.plannedQty.toString())} ${unit} planned (${percent.toString()}%). `
        + 'Approving deducts the ingredients and adds it to stock.',
      referenceType: 'ProductionOrder',
      referenceId:   order.id,
    })))
  },

  /**
   * A reported completion was decided: tell whoever reported it — approved
   * with the lot now in stock, or sent back with the reason (D11). The
   * reporter is read from the status log, because a rejection clears the
   * order's completedById. Nothing is sent if the order has moved on from
   * what the decision left (e.g. already re-reported).
   */
  async notifyCompletionDecided(productionOrderId: string): Promise<number> {
    const [order, [latest], changes] = await Promise.all([
      ProductionOrderRepository.findById(productionOrderId),
      ApprovalRepository.findByReference('ProductionCompletion', productionOrderId),
      ProductionOrderRepository.findStatusChanges(productionOrderId),
    ])
    if (!order || !latest) return 0

    const approved = latest.decision === 'APPROVED'
    if (order.status !== (approved ? 'COMPLETED' : 'IN_PROGRESS')) return 0

    const report = [...changes].reverse().find(change => change.toStatus === 'PENDING_COMPLETION')
    if (!report || report.changedBy.id === latest.approver.id) return 0

    const unit = order.bom.batchUnit.abbreviation
    return createAndPush([{
      userId:        report.changedBy.id,
      type:          approved ? 'PRODUCTION_COMPLETION_APPROVED' : 'PRODUCTION_COMPLETION_REJECTED',
      title:         approved
        ? `${order.orderNumber} completion approved`
        : `${order.orderNumber} completion sent back`,
      body:          approved
        ? `${latest.approver.name} approved it: ${trimDecimal(order.actualQty?.toString() ?? '0')} ${unit} ${order.finishedGood.name} `
          + `is in stock at ${order.branch.name} as lot ${order.orderNumber}`
          + (order.costPerUnit === null ? '.' : ` — it cost ${formatPeso(order.costPerUnit.toString())}/${unit}.`)
        : `${latest.approver.name}: ${latest.remarks ?? 'no reason given'}. Report the run again when corrected.`,
      referenceType: 'ProductionOrder',
      referenceId:   order.id,
    }])
  },

  /**
   * Production recorded a conversion: tell everyone who can decide it except
   * whoever recorded it (Week 7 Task 1, D9). Re-reads the order — gone, or
   * already decided, means nothing to say.
   */
  async notifyConversionSubmitted(conversionOrderId: string): Promise<number> {
    const order = await ConversionOrderRepository.findById(conversionOrderId)
    if (!order || order.status !== 'PENDING_APPROVAL') return 0

    const approvers  = await UserRepository.findByRoles(APPROVER_ROLES)
    const recipients = approvers.filter(user => user.id !== order.submittedBy.id)

    return createAndPush(recipients.map(user => ({
      userId:        user.id,
      type:          'CONVERSION_ORDER_SUBMITTED',
      title:         `${order.orderNumber} is waiting for approval`,
      body:          `${order.submittedBy.name} converted ${formatQuantity(order.sourceQty.toString())} ${order.sourceFinishedGood.unit.abbreviation} `
        + `${order.sourceFinishedGood.name} into ${formatQuantity(order.outputQty.toString())} ${order.finishedGood.unit.abbreviation} `
        + `${order.finishedGood.name} at ${order.branch.name}. Approving moves the stock.`,
      referenceType: 'ConversionOrder',
      referenceId:   order.id,
    })))
  },

  /**
   * A conversion was decided: tell whoever recorded it — approved with the
   * new lot and its cost, or rejected with the reason. The approver is never
   * told about their own decision (and cannot be the recorder anyway).
   */
  async notifyConversionDecided(conversionOrderId: string): Promise<number> {
    const [order, [latest]] = await Promise.all([
      ConversionOrderRepository.findById(conversionOrderId),
      ApprovalRepository.findByReference('ConversionOrder', conversionOrderId),
    ])
    if (!order || !latest || order.status === 'PENDING_APPROVAL') return 0
    if (order.submittedBy.id === latest.approver.id) return 0

    const approved = order.status === 'APPROVED'
    const unit     = order.finishedGood.unit.abbreviation
    return createAndPush([{
      userId:        order.submittedBy.id,
      type:          approved ? 'CONVERSION_ORDER_APPROVED' : 'CONVERSION_ORDER_REJECTED',
      title:         `${order.orderNumber} was ${approved ? 'approved' : 'rejected'}`,
      body:          approved
        ? `${latest.approver.name} approved it: ${formatQuantity(order.outputQty.toString())} ${unit} ${order.finishedGood.name} `
          + `is in stock at ${order.branch.name} as lot ${order.orderNumber}`
          + (order.costPerUnit === null ? '.' : ` — it cost ${formatPeso(order.costPerUnit.toString())}/${unit}.`)
        : `${latest.approver.name}: ${latest.remarks ?? 'no reason given'}. Record it again with the right figures if it did happen.`,
      referenceType: 'ConversionOrder',
      referenceId:   order.id,
    }])
  },

  /**
   * Production recorded a write-off: tell everyone who can decide it except
   * whoever recorded it (Week 7 Task 2, W8). Re-reads it — gone, or already
   * decided, means nothing to say.
   */
  async notifyWriteOffSubmitted(writeOffId: string): Promise<number> {
    const row = await WriteOffRepository.findById(writeOffId)
    if (!row || row.status !== 'PENDING_APPROVAL') return 0

    const unit       = row.lot.finishedGood.unit.abbreviation
    const lotCost    = row.lot.movements[0]?.unitCost ?? null
    const approvers  = await UserRepository.findByRoles(APPROVER_ROLES)
    const recipients = approvers.filter(user => user.id !== row.submittedBy.id)

    return createAndPush(recipients.map(user => ({
      userId:        user.id,
      type:          'WRITE_OFF_SUBMITTED',
      title:         `${row.writeOffNumber} is waiting for approval`,
      body:          `${row.submittedBy.name} wrote off ${formatQuantity(row.quantity.toString())} ${unit} ${row.lot.finishedGood.name} `
        + `from lot ${row.lot.lotNumber} at ${row.branch.name} — ${reasonLabel(row.reason).toLowerCase()}`
        + (lotCost === null ? '.' : `, about ${formatPeso(row.quantity.mul(lotCost).toString())}.`),
      referenceType: 'WriteOff',
      referenceId:   row.id,
    })))
  },

  /**
   * A write-off was decided: tell whoever recorded it — approved with the
   * value written off, or rejected with the reason.
   */
  async notifyWriteOffDecided(writeOffId: string): Promise<number> {
    const [row, [latest]] = await Promise.all([
      WriteOffRepository.findById(writeOffId),
      ApprovalRepository.findByReference('WriteOff', writeOffId),
    ])
    if (!row || !latest || row.status === 'PENDING_APPROVAL') return 0
    if (row.submittedBy.id === latest.approver.id) return 0

    const approved = row.status === 'APPROVED'
    const unit     = row.lot.finishedGood.unit.abbreviation
    return createAndPush([{
      userId:        row.submittedBy.id,
      type:          approved ? 'WRITE_OFF_APPROVED' : 'WRITE_OFF_REJECTED',
      title:         `${row.writeOffNumber} was ${approved ? 'approved' : 'rejected'}`,
      body:          approved
        ? `${latest.approver.name} approved it: ${formatQuantity(row.quantity.toString())} ${unit} ${row.lot.finishedGood.name} `
          + `left lot ${row.lot.lotNumber} at ${row.branch.name}`
          + (row.totalCost === null ? '.' : ` — ${formatPeso(row.totalCost.toString())} written off.`)
        : `${latest.approver.name}: ${latest.remarks ?? 'no reason given'}. Record it again with the right figures if the food was thrown away.`,
      referenceType: 'WriteOff',
      referenceId:   row.id,
    }])
  },

  /**
   * The kitchen recorded a transfer: tell everyone who can decide it except
   * whoever recorded it (Week 8 Task 3, R7). Re-reads it — gone, or already
   * decided, means nothing to say.
   */
  async notifyTransferSubmitted(stockTransferId: string): Promise<number> {
    const row = await StockTransferRepository.findById(stockTransferId)
    if (!row || row.status !== 'PENDING_APPROVAL') return 0

    const approvers  = await UserRepository.findByRoles(APPROVER_ROLES)
    const recipients = approvers.filter(user => user.id !== row.submittedById)
    return createAndPush(recipients.map(user => ({
      userId:        user.id,
      type:          'TRANSFER_SUBMITTED',
      title:         `${row.transferNumber} is waiting for approval`,
      body:          `${row.submittedBy.name} is sending ${transferGoods(row)} from ${row.fromBranch.name} to ${row.toBranch.name}. Approving dispatches it.`,
      referenceType: 'StockTransfer',
      referenceId:   row.id,
    })))
  },

  /**
   * A transfer was decided. Approved — it is dispatched: tell whoever
   * recorded it, and the receiving branch's manager that it is on its way and
   * to confirm when it arrives (read from Branch.managerId). Rejected: tell
   * whoever recorded it, with the reason.
   */
  async notifyTransferDecided(stockTransferId: string): Promise<number> {
    const [row, [latest]] = await Promise.all([
      StockTransferRepository.findById(stockTransferId),
      ApprovalRepository.findByReference('StockTransfer', stockTransferId),
    ])
    if (!row || !latest || row.status === 'PENDING_APPROVAL') return 0
    if (row.submittedById === latest.approver.id) return 0

    if (latest.decision !== 'APPROVED') {
      return createAndPush([{
        userId:        row.submittedById,
        type:          'TRANSFER_REJECTED',
        title:         `${row.transferNumber} was rejected`,
        body:          `${latest.approver.name}: ${latest.remarks ?? 'no reason given'}. Nothing was sent to ${row.toBranch.name}; record a new transfer if it should go.`,
        referenceType: 'StockTransfer',
        referenceId:   row.id,
      }])
    }

    const goods   = transferGoods(row)
    const manager = (await BranchRepository.findProfile(row.toBranchId))?.manager ?? null
    const messages: CreateNotificationInput[] = [{
      userId:        row.submittedById,
      type:          'TRANSFER_APPROVED',
      title:         `${row.transferNumber} was approved — on its way`,
      body:          `${latest.approver.name} approved it: ${goods} left ${row.fromBranch.name} for ${row.toBranch.name}.`,
      referenceType: 'StockTransfer',
      referenceId:   row.id,
    }]
    if (manager && manager.id !== row.submittedById && manager.id !== latest.approver.id) {
      messages.push({
        userId:        manager.id,
        type:          'TRANSFER_DISPATCHED',
        title:         `${row.transferNumber} is on its way to ${row.toBranch.name}`,
        body:          `${goods} from ${row.fromBranch.name}. Confirm it arrived when it does — it joins your stock then.`,
        referenceType: 'StockTransfer',
        referenceId:   row.id,
      })
    }
    return createAndPush(messages)
  },

  /**
   * The receiving branch confirmed what arrived: tell whoever recorded it,
   * naming any shortfall. A short receipt (Task 4, V6) is logged, not
   * approved, so accounting and admins are told as well — not whoever
   * confirmed it, and not the recorder twice.
   */
  async notifyTransferReceived(stockTransferId: string): Promise<number> {
    const row = await StockTransferRepository.findById(stockTransferId)
    if (!row || row.status !== 'RECEIVED') return 0

    const receiver = row.receivedBy?.name ?? 'The branch'
    // A reason is recorded exactly when something arrived short (V4).
    const lost = row.varianceReason === null ? null : [
      row.varianceValue === null ? 'Value unknown' : formatPeso(row.varianceValue.toString()),
      ` lost in transit — ${transferVarianceReasonLabel(row.varianceReason)}`,
      row.varianceNotes ? `: ${row.varianceNotes}` : '',
    ].join('')

    const messages: CreateNotificationInput[] = []
    if (row.receivedById !== row.submittedById) {
      messages.push({
        userId:        row.submittedById,
        type:          'TRANSFER_RECEIVED',
        title:         lost ? `${row.transferNumber} arrived short at ${row.toBranch.name}` : `${row.transferNumber} arrived at ${row.toBranch.name}`,
        body:          lost
          ? `${receiver} counted what arrived of ${transferGoods(row)}. ${lost}.`
          : `${receiver} confirmed ${transferGoods(row)} arrived.`,
        referenceType: 'StockTransfer',
        referenceId:   row.id,
      })
    }
    if (lost) {
      const watchers = (await UserRepository.findByRoles(APPROVER_ROLES))
        .filter(user => user.id !== row.receivedById && user.id !== row.submittedById)
      for (const user of watchers) {
        messages.push({
          userId:        user.id,
          type:          'TRANSFER_VARIANCE',
          title:         `${row.transferNumber} arrived short at ${row.toBranch.name}`,
          body:          `${receiver} counted what arrived of ${transferGoods(row)} from ${row.fromBranch.name}. ${lost}.`,
          referenceType: 'StockTransfer',
          referenceId:   row.id,
        })
      }
    }
    return createAndPush(messages)
  },
}

/** "Bopis 6 kg, Dinuguan 2 kg" — what a transfer carries, for a notification. */
function transferGoods(row: StockTransferWithDetail): string {
  return row.items.map(item => `${item.finishedGood.name} ${formatQuantity(item.quantity.toString())} ${item.finishedGood.unit.abbreviation}`).join(', ')
}
