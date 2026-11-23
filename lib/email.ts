import { config } from '@/lib/config'

/**
 * The Resend client (Week 11 Task 2) — one HTTPS call, so plain fetch rather
 * than another dependency. NODE RUNTIME ONLY in practice: it is called from the
 * worker and from route handlers, never from middleware or the browser.
 *
 * The API key is read from config and sent only in the Authorization header;
 * nothing here logs it or puts it in an error message.
 */

const RESEND_URL = 'https://api.resend.com/emails'
const TIMEOUT_MS = 15_000

export type EmailAttachment = {
  filename: string
  /** The file's bytes. */
  content: Buffer
}

export type SendEmailInput = {
  to: string
  subject: string
  html: string
  text: string
  attachments?: EmailAttachment[]
  /**
   * Resend keeps a key for 24 hours and answers a repeat with the first
   * result instead of sending again — so a retried job cannot send twice.
   */
  idempotencyKey?: string
}

export type SendEmailResult =
  | { ok: true; id: string }
  /** `retryable`: busy, rate-limited or unreachable — worth another attempt. */
  | { ok: false; error: string; retryable: boolean }

export function emailConfigured(): boolean {
  return config.resendApiKey !== null
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!config.resendApiKey) {
    return { ok: false, error: 'Email is not set up (RESEND_API_KEY)', retryable: false }
  }

  let response: Response
  try {
    response = await fetch(RESEND_URL, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${config.resendApiKey}`,
        'Content-Type': 'application/json',
        ...(input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from:    config.emailFrom,
        to:      [input.to],
        subject: input.subject,
        html:    input.html,
        text:    input.text,
        ...(input.attachments?.length
          ? { attachments: input.attachments.map(file => ({ filename: file.filename, content: file.content.toString('base64') })) }
          : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'could not be reached'
    return { ok: false, error: `Resend ${reason}`, retryable: true }
  }

  const body: unknown = await response.json().catch(() => null)
  if (response.ok) {
    const id = typeof body === 'object' && body !== null && 'id' in body && typeof body.id === 'string' ? body.id : ''
    return { ok: true, id }
  }

  // Resend answers errors as { statusCode, name, message }.
  const message = typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string'
    ? body.message
    : `HTTP ${response.status}`
  return {
    ok:        false,
    error:     `Resend refused it: ${message}`,
    retryable: response.status === 429 || response.status >= 500,
  }
}
