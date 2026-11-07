import { Role } from '@prisma/client'
import { trimDecimal } from '@/lib/format'
import { publishNotificationsChanged } from '@/lib/realtime'
import { InventoryRepository } from '@/repositories/inventory.repository'
import { CreateNotificationInput, NotificationRepository } from '@/repositories/notification.repository'
import { InventoryService, reorderAlerts } from '@/services/inventory.service'
import { PurchaseRequestRepository } from '@/repositories/purchase-request.repository'
import { UserRepository } from '@/repositories/user.repository'

/** Roles that can decide a purchase request, and therefore need to know one is waiting. */
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
   * ledger total, one notification to each ADMIN naming them. Everything
   * agreeing is the normal case and sends nothing. Same per-day guard as the
   * low-stock summary, keyed by `date`.
   */
  async notifyStockMismatches(date: string): Promise<{ mismatches: number; written: number }> {
    const mismatches = await InventoryRepository.mismatchedLevels()
    if (mismatches.length === 0) return { mismatches: 0, written: 0 }

    const [admins, alreadyTold] = await Promise.all([
      UserRepository.findByRoles([Role.ADMIN]),
      NotificationRepository.userIdsWithReference('StockReconciliation', date),
    ])

    const named = mismatches.slice(0, SUMMARY_NAMES).map(row => {
      const unit = row.unitAbbreviation
      return `${row.materialName} at ${row.branchName}: ledger ${trimDecimal(row.ledgerTotal.toString())} ${unit}, `
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
}
