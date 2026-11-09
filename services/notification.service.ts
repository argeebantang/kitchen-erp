import { Role } from '@prisma/client'
import { formatPeso, trimDecimal } from '@/lib/format'
import { publishNotificationsChanged } from '@/lib/realtime'
import { InventoryRepository } from '@/repositories/inventory.repository'
import { FinishedGoodStockRepository } from '@/repositories/finished-good-stock.repository'
import { CreateNotificationInput, NotificationRepository } from '@/repositories/notification.repository'
import { InventoryService, reorderAlerts } from '@/services/inventory.service'
import { PurchaseRequestRepository } from '@/repositories/purchase-request.repository'
import { ProductionOrderRepository } from '@/repositories/production-order.repository'
import { ApprovalRepository } from '@/repositories/approval.repository'
import { ProductionOrderService } from '@/services/production-order.service'
import { UserRepository } from '@/repositories/user.repository'

/** Roles that can decide a purchase request or production order, and therefore need to know one is waiting. */
const APPROVER_ROLES: Role[] = [Role.ACCOUNTING, Role.ADMIN]

/** Roles that raise purchase requests, and therefore need to know what to reorder. */
const ORDERING_ROLES: Role[] = [Role.PROCUREMENT_MANAGER, Role.ADMIN]

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
  StockReconciliation: () => '/inventory/ledger',
  ProductionOrder:     id => `/production/orders/${id}`,
  // Procurement cannot open production orders; their link is the purchase
  // request pre-filled with the shortfall (Week 5 Task 4).
  ProductionOrderShortfall: id => `/procurement/requests/new?productionOrder=${id}`,
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
}
