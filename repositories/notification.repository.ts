import { prisma } from '@/lib/prisma'

export type CreateNotificationInput = {
  userId: string
  type: string
  title: string
  body?: string | null
  referenceType?: string | null
  referenceId?: string | null
}

export const NotificationRepository = {
  /**
   * Inserts every row in ONE statement. A loop of create() calls would be a
   * round trip per recipient — tolerable for three approvers, wasteful at
   * fifty, and exactly the batching docs/coding-conventions.md asks for.
   *
   * createMany returns a count, not the rows.
   */
  async createMany(inputs: CreateNotificationInput[]): Promise<number> {
    if (inputs.length === 0) return 0

    const result = await prisma.notification.createMany({
      data: inputs.map(input => ({
        userId:        input.userId,
        type:          input.type,
        title:         input.title,
        body:          input.body ?? null,
        referenceType: input.referenceType ?? null,
        referenceId:   input.referenceId ?? null,
      })),
    })

    return result.count
  },

  /**
   * Who already has a notification about this document — the low-stock
   * summary uses the date as its referenceId, so this is "who has been told
   * today". Not indexed: it runs once a day, and Notification(userId, readAt)
   * serves the reads users make.
   */
  async userIdsWithReference(referenceType: string, referenceId: string): Promise<Set<string>> {
    const rows = await prisma.notification.findMany({
      where:  { referenceType, referenceId },
      select: { userId: true },
    })
    return new Set(rows.map(row => row.userId))
  },
}
