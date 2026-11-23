import { prisma } from '@/lib/prisma'

export type ApprovalReminderKey = {
  userId: string
  referenceType: string
  referenceId: string
  /** How many whole 24-hour steps the document had waited: 1 at 24 h, 2 at 48 h… */
  tier: number
}

/** ApprovalReminder (Week 11 Task 3): who was reminded about which overdue document, at which step. */
export const ApprovalReminderRepository = {
  /**
   * Claims these reminders and returns the ones this call got — rows another
   * run (or an earlier hour) already holds are skipped by the unique key
   * (INSERT … ON CONFLICT DO NOTHING), so only the returned ones are sent.
   * One statement.
   */
  async claim(keys: ApprovalReminderKey[]): Promise<ApprovalReminderKey[]> {
    if (keys.length === 0) return []
    return prisma.approvalReminder.createManyAndReturn({
      data:           keys,
      skipDuplicates: true,
      select:         { userId: true, referenceType: true, referenceId: true, tier: true },
    })
  },
}
