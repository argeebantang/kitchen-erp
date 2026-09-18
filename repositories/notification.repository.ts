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
}
