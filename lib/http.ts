/**
 * JSON requests from Client Components, with one way of failing (Week 12
 * Task 2). Never throws: the caller gets `{ ok: true, data }` or
 * `{ ok: false, error }` with a sentence a user can act on, so a form can
 * always leave its "Saving…" state and say what went wrong.
 *
 * Client-safe: no Prisma, no Node APIs, no 'use client' needed.
 */

export type RequestResult<T> =
  | { ok: true;  status: number; data: T }
  | { ok: false; status: number; error: string }

type Options = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?:   unknown
  /** Field name → label, for a 400 "Validation failed" ({ reorderPoint: 'Reorder point' }). */
  fields?: Record<string, string>
}

export const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.'

const STATUS_MESSAGES: Record<number, string> = {
  401: 'Your session has ended. Sign in again.',
  403: 'Your role cannot do this.',
  404: 'It no longer exists. Reload the page.',
  409: 'Someone else changed this first. Reload the page and try again.',
  429: 'Too many requests. Wait a moment and try again.',
}

export async function requestJson<T = unknown>(url: string, options: Options = {}): Promise<RequestResult<T>> {
  const { method = options.body === undefined ? 'GET' : 'POST', body, fields } = options

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body:    body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    return { ok: false, status: 0, error: NETWORK_ERROR }
  }

  // middleware.ts answers a missing session or a role guard with a redirect —
  // to /login or /unauthorized — even for /api/*. fetch follows it and gets a
  // 200 HTML page, which must not count as success.
  if (response.redirected) {
    const path = new URL(response.url).pathname
    if (path === '/login')        return { ok: false, status: 401, error: STATUS_MESSAGES[401] }
    if (path === '/unauthorized') return { ok: false, status: 403, error: STATUS_MESSAGES[403] }
  }

  const data: unknown = await response.json().catch(() => null)
  if (response.ok) return { ok: true, status: response.status, data: data as T }
  return { ok: false, status: response.status, error: errorMessage(response.status, data, fields) }
}

/**
 * The sentence for a failed response. The server's own message wins — the
 * services write them for users ("Only the kitchen records transfers") —
 * except the generic ones, which say nothing a user can act on.
 */
export function errorMessage(status: number, data: unknown, fields?: Record<string, string>): string {
  const body = (data !== null && typeof data === 'object' ? data : {}) as {
    error?: unknown
    fields?: Record<string, string[] | undefined>
  }
  const text = typeof body.error === 'string' ? body.error : null

  // "Validation failed" alone tells the user nothing — name each field and its
  // rule, as the Branches panel did first: "Name: … · Reorder point: …".
  if (text === 'Validation failed') {
    const problems = Object.entries(body.fields ?? {})
      .filter(([, messages]) => messages && messages.length > 0)
      .map(([name, messages]) => `${fields?.[name] ?? name}: ${messages!.join(', ')}`)
    return problems.length > 0 ? problems.join(' · ') : 'Some fields are not valid. Check the form.'
  }
  if (text && text !== 'Internal server error' && text !== 'Unauthorized') return text
  return STATUS_MESSAGES[status]
    ?? (status >= 500 ? 'The server had a problem. Try again in a moment.' : `Request failed (${status}).`)
}
