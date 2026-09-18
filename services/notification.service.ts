import { Role } from '@prisma/client'
import { NotificationRepository } from '@/repositories/notification.repository'
import { PurchaseRequestRepository } from '@/repositories/purchase-request.repository'
import { UserRepository } from '@/repositories/user.repository'

/** Roles that can decide a purchase request, and therefore need to know one is waiting. */
const APPROVER_ROLES: Role[] = [Role.ACCOUNTING, Role.ADMIN]

export const NotificationService = {
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

    return NotificationRepository.createMany(
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
}