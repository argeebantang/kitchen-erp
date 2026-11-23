import { EmailStatus } from '@prisma/client'
import { config } from '@/lib/config'
import { emailConfigured, sendEmail, type EmailAttachment } from '@/lib/email'
import { EmailLogRepository } from '@/repositories/email-log.repository'
import { NotificationRepository } from '@/repositories/notification.repository'
import { UserRepository } from '@/repositories/user.repository'
import { notificationHref } from '@/services/notification.service'
import { ReportService } from '@/services/report.service'
import { renderReportPdf } from '@/lib/report-pdf'
import { reportFileName } from '@/lib/report-format'
import type { NotificationEmailJob } from '@/lib/queue'

/**
 * Email (Week 11 Task 2). Every email goes to a user's `notificationEmail` —
 * never to their login email, which for the seed and history accounts is on a
 * real domain nobody here owns. No address, no email.
 *
 * A notification's email is its copy: the same title and text, with a link to
 * the same page as the bell. The bell is written first and never waits for
 * the email (EMAIL_QUEUE); without RESEND_API_KEY the email is logged SKIPPED
 * and nothing else changes.
 */

/** How many log rows Admin → Email shows. */
export const LATEST_EMAILS = 50

/** What a send attempt came to. RETRY: throw so BullMQ tries again. */
export type EmailOutcome = 'SENT' | 'SKIPPED' | 'FAILED' | 'RETRY' | 'NO_ADDRESS' | 'ALREADY_SENT' | 'GONE'

export type EmailResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status: number }

export type EmailLogDto = {
  id: string
  kind: string
  status: EmailStatus
  toAddress: string | null
  userName: string | null
  subject: string
  error: string | null
  createdAt: string
}

export type EmailRecipientDto = {
  id: string
  name: string
  role: string
  loginEmail: string
  notificationEmail: string | null
}

export type EmailOverviewDto = {
  configured: boolean
  from: string
  users: EmailRecipientDto[]
  latest: EmailLogDto[]
  lastSevenDays: Record<EmailStatus, number>
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** A page of the app as a full link for an email. */
export function absoluteUrl(href: string): string {
  return `${config.appUrl.replace(/\/+$/, '')}${href.startsWith('/') ? href : `/${href}`}`
}

/**
 * One email in the app's look: a heading, paragraphs, an optional button.
 * Inline styles and a table, because mail clients ignore stylesheets. Every
 * piece of text is escaped — titles and bodies carry names users typed.
 */
export function renderEmail(input: {
  greeting: string
  heading: string
  paragraphs: string[]
  link: { url: string; label: string } | null
  footer: string
}): { html: string; text: string } {
  const paragraphs = input.paragraphs
    .map(text => `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#374151">${escapeHtml(text)}</p>`)
    .join('')
  const button = input.link
    ? `<p style="margin:20px 0 4px"><a href="${escapeHtml(input.link.url)}" style="display:inline-block;background:#f97316;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">${escapeHtml(input.link.label)}</a></p>`
    : ''
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f9fafb">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f9fafb;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;font-family:Arial,Helvetica,sans-serif">
<tr><td style="padding:20px 24px 0;font-size:13px;font-weight:700;color:#ea580c">KitchenERP</td></tr>
<tr><td style="padding:12px 24px 24px">
<p style="margin:0 0 12px;font-size:14px;color:#6b7280">${escapeHtml(input.greeting)}</p>
<h1 style="margin:0 0 12px;font-size:18px;line-height:1.35;color:#111827">${escapeHtml(input.heading)}</h1>
${paragraphs}${button}
</td></tr>
<tr><td style="padding:12px 24px 20px;border-top:1px solid #f3f4f6;font-size:12px;color:#9ca3af">${escapeHtml(input.footer)}</td></tr>
</table></td></tr></table></body></html>`
  const text = [
    input.greeting, '', input.heading, '', ...input.paragraphs.flatMap(paragraph => [paragraph, '']),
    ...(input.link ? [`${input.link.label}: ${input.link.url}`, ''] : []),
    '—', input.footer,
  ].join('\n')
  return { html, text }
}

/** Who the worker generates an emailed report as: it has no user, and management sees every branch. */
const REPORT_VIEWER = { userId: '', role: 'ADMIN' }

const NOTIFICATION_FOOTER = 'A copy of a notification in your KitchenERP bell. Your administrator sets where these emails go (Admin → Email).'

export const EmailService = {
  /**
   * The email copy of one notification (the NOTIFICATION_EMAIL job). Logs the
   * outcome once, after the last attempt; a user with no address is not
   * logged — that is by design, not a failure.
   */
  async sendNotification(
    notificationId: string,
    options: { lastAttempt: boolean; attachment?: NotificationEmailJob['attachment'] },
  ): Promise<EmailOutcome> {
    const notification = await NotificationRepository.findForEmail(notificationId)
    if (!notification) return 'GONE'
    const address = notification.user.notificationEmail
    if (!address) return 'NO_ADDRESS'
    if (await EmailLogRepository.wasSent(notification.id)) return 'ALREADY_SENT'

    const entry = { kind: 'NOTIFICATION', userId: notification.user.id, notificationId: notification.id, toAddress: address, subject: notification.title }
    if (!emailConfigured()) {
      await EmailLogRepository.create({ ...entry, status: EmailStatus.SKIPPED, error: 'Email is not set up (RESEND_API_KEY)' })
      return 'SKIPPED'
    }

    // The report PDF it carries (Task 6), generated now from the figures as
    // they stand — the same report as the Reports page. A failure is retried
    // like a busy Resend, then logged FAILED: no half email without its PDF.
    let attachments: EmailAttachment[] | undefined
    if (options.attachment) {
      try {
        const { report, date, branchId } = options.attachment
        const built = await ReportService.run(report, { date, branchId }, REPORT_VIEWER)
        if (!built.success) throw new Error(built.error)
        attachments = [{ filename: reportFileName(built.data, 'pdf'), content: await renderReportPdf(built.data) }]
      } catch (err) {
        if (!options.lastAttempt) return 'RETRY'
        await EmailLogRepository.create({ ...entry, status: EmailStatus.FAILED, error: `Could not build the PDF: ${err instanceof Error ? err.message : 'unknown error'}` })
        return 'FAILED'
      }
    }

    const href = notificationHref(notification.referenceType, notification.referenceId)
    const { html, text } = renderEmail({
      greeting:   `Hi ${notification.user.name},`,
      heading:    notification.title,
      paragraphs: [
        ...(notification.body ? [notification.body] : []),
        ...(attachments ? [`The full snapshot is attached as a PDF (${attachments[0].filename}).`] : []),
      ],
      link:       href ? { url: absoluteUrl(href), label: 'Open in KitchenERP' } : null,
      footer:     NOTIFICATION_FOOTER,
    })
    // The notification id as the idempotency key: a job retried after Resend
    // accepted it (the reply lost) cannot send it twice.
    const result = await sendEmail({ to: address, subject: notification.title, html, text, attachments, idempotencyKey: `notification-${notification.id}` })
    if (result.ok) {
      await EmailLogRepository.create({ ...entry, status: EmailStatus.SENT, providerId: result.id })
      return 'SENT'
    }
    if (result.retryable && !options.lastAttempt) return 'RETRY'
    await EmailLogRepository.create({ ...entry, status: EmailStatus.FAILED, error: result.error })
    return 'FAILED'
  },

  /**
   * Any one-off email to a user (a test, later a report): sent now, logged
   * either way. Used from a request, so it does not retry — the person sees
   * the result and can press the button again.
   */
  async sendToUser(input: {
    userId: string
    kind: string
    subject: string
    content: { html: string; text: string }
    attachments?: EmailAttachment[]
  }): Promise<EmailResult<{ to: string }>> {
    const user = await UserRepository.findNotificationEmail(input.userId)
    if (!user) return { success: false, error: 'User not found', status: 404 }
    if (!user.notificationEmail) {
      return { success: false, error: `${user.name} has no notification email — set one under Admin → Email`, status: 400 }
    }

    const entry = { kind: input.kind, userId: input.userId, toAddress: user.notificationEmail, subject: input.subject }
    if (!emailConfigured()) {
      await EmailLogRepository.create({ ...entry, status: EmailStatus.SKIPPED, error: 'Email is not set up (RESEND_API_KEY)' })
      return { success: false, error: 'Email is not set up — add RESEND_API_KEY to .env, then restart npm run dev and npm run worker', status: 409 }
    }

    const result = await sendEmail({ to: user.notificationEmail, subject: input.subject, ...input.content, attachments: input.attachments })
    if (!result.ok) {
      await EmailLogRepository.create({ ...entry, status: EmailStatus.FAILED, error: result.error })
      return { success: false, error: result.error, status: 502 }
    }
    await EmailLogRepository.create({ ...entry, status: EmailStatus.SENT, providerId: result.id })
    return { success: true, data: { to: user.notificationEmail } }
  },

  /** Admin → Email's test button: a short email to the admin's own notification address. */
  async sendTest(userId: string): Promise<EmailResult<{ to: string }>> {
    const user = await UserRepository.findNotificationEmail(userId)
    const content = renderEmail({
      greeting:   `Hi ${user?.name ?? 'there'},`,
      heading:    'KitchenERP can email you',
      paragraphs: ['This is the test from Admin → Email. Approval requests, decisions, reminders and the end-of-day summary will arrive like this.'],
      link:       { url: absoluteUrl('/admin/email'), label: 'Open Admin → Email' },
      footer:     'Sent because you pressed Send a test email.',
    })
    return EmailService.sendToUser({ userId, kind: 'TEST', subject: 'KitchenERP test email', content })
  },

  /** Where a user's emails go; an empty value stops them. */
  async setNotificationEmail(userId: string, address: string | null): Promise<EmailResult<{ notificationEmail: string | null }>> {
    const updated = await UserRepository.setNotificationEmail(userId, address)
    if (!updated) return { success: false, error: 'User not found', status: 404 }
    return { success: true, data: { notificationEmail: address } }
  },

  async overview(): Promise<EmailOverviewDto> {
    const since = new Date(Date.now() - 7 * 24 * 3_600_000)
    const [users, latest, lastSevenDays] = await Promise.all([
      UserRepository.listWithNotificationEmail(),
      EmailLogRepository.latest(LATEST_EMAILS),
      EmailLogRepository.countsSince(since),
    ])
    return {
      configured: emailConfigured(),
      from:       config.emailFrom,
      users:      users.map(user => ({
        id: user.id, name: user.name, role: user.role, loginEmail: user.email, notificationEmail: user.notificationEmail,
      })),
      latest: latest.map(row => ({
        id:        row.id,
        kind:      row.kind,
        status:    row.status,
        toAddress: row.toAddress,
        userName:  row.user?.name ?? null,
        subject:   row.subject,
        error:     row.error,
        createdAt: row.createdAt.toISOString(),
      })),
      lastSevenDays,
    }
  },
}
