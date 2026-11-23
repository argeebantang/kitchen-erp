import { EmailStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export type CreateEmailLogInput = {
  kind: string
  status: EmailStatus
  userId: string | null
  notificationId?: string | null
  toAddress: string | null
  subject: string
  providerId?: string | null
  error?: string | null
}

/** EmailLog (Week 11 Task 2): one row per email sent, skipped or failed. */
export const EmailLogRepository = {
  async create(input: CreateEmailLogInput): Promise<void> {
    await prisma.emailLog.create({
      data: {
        kind:           input.kind,
        status:         input.status,
        userId:         input.userId,
        notificationId: input.notificationId ?? null,
        toAddress:      input.toAddress,
        subject:        input.subject,
        providerId:     input.providerId ?? null,
        error:          input.error ?? null,
      },
    })
  },

  /** A notification's email already went out — a re-run job must not send it twice. */
  async wasSent(notificationId: string): Promise<boolean> {
    const row = await prisma.emailLog.findFirst({
      where:  { notificationId, status: EmailStatus.SENT },
      select: { id: true },
    })
    return row !== null
  },

  /** Newest first, with who it was for. Served by @@index([createdAt]). */
  async latest(take: number) {
    return prisma.emailLog.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      select: {
        id: true, kind: true, status: true, toAddress: true, subject: true, error: true, createdAt: true,
        user: { select: { name: true } },
      },
    })
  },

  /** How many of each status since `since`. */
  async countsSince(since: Date): Promise<Record<EmailStatus, number>> {
    const rows = await prisma.emailLog.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: { _all: true } })
    const counts: Record<EmailStatus, number> = { SENT: 0, SKIPPED: 0, FAILED: 0 }
    for (const row of rows) counts[row.status] = row._count._all
    return counts
  },
}
