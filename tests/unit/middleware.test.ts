import { Role } from '@prisma/client'
import { SignJWT } from 'jose'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { middleware } from '@/middleware'
import { COOKIE_NAME, signToken } from '@/lib/jwt'
import { ASSISTANT_ROLES } from '@/services/assistant.service'

/**
 * middleware.ts is the only thing that decides who may reach a URL — and for
 * some actions the only check at all: the decision services do not re-check
 * the role (PurchaseRequestService.applyDecision: "No role check here"), so
 * the /api/approvals guard alone keeps a VIEWER from approving purchases.
 * The service-level integration tests never pass through it; these do.
 *
 * middleware() is a plain function: each test signs a real JWT for a role,
 * builds a NextRequest with it as the cookie, and reads the response.
 *
 * The ACCESS table below is written out by hand on purpose. It is the
 * expected access, kept apart from ROLE_GUARDS: a table derived from
 * ROLE_GUARDS would agree with any mistake made there.
 */

const { ADMIN, PROCUREMENT_MANAGER, PRODUCTION_MANAGER, BRANCH_MANAGER, ACCOUNTING, VIEWER } = Role
const EVERYONE = Object.values(Role)

type Outcome = 'allowed' | 'login' | 'unauthorized' | 401 | 403

type Send = {
  role?: Role
  method?: string
  /** A link the browser opens itself (a PDF download), not a fetch from code. */
  navigate?: boolean
  token?: string
  headers?: Record<string, string>
}

async function tokenFor(role: Role): Promise<string> {
  return signToken({ userId: `user-${role}`, email: `${role.toLowerCase()}@test.local`, role })
}

async function send(path: string, options: Send = {}) {
  const headers = new Headers(options.headers)
  const token = options.token ?? (options.role ? await tokenFor(options.role) : undefined)
  if (token !== undefined) headers.set('cookie', `${COOKIE_NAME}=${token}`)
  if (options.navigate) headers.set('sec-fetch-mode', 'navigate')
  return middleware(new NextRequest(`http://localhost:3000${path}`, { method: options.method ?? 'GET', headers }))
}

/** What the response means for the person who sent it. */
function outcome(res: Response): Outcome {
  if (res.headers.get('x-middleware-next') === '1') return 'allowed'
  if (res.status === 307) {
    const location = new URL(res.headers.get('location')!)
    if (location.pathname === '/login') return 'login'
    if (location.pathname === '/unauthorized') return 'unauthorized'
  }
  if (res.status === 401 || res.status === 403) return res.status
  throw new Error(`Unexpected response ${res.status} ${res.headers.get('location') ?? ''}`)
}

// ─── Who may reach what ──────────────────────────────────────────────────────

/** [method, path, the roles allowed through]. Everyone else is refused. */
const ACCESS: [string, string, Role[]][] = [
  // Approvals: the only role check on approving anything.
  ['POST',   '/api/approvals',                          [ADMIN, ACCOUNTING]],
  ['GET',    '/procurement/approvals',                  [ADMIN, ACCOUNTING]],

  // Procurement
  ['GET',    '/procurement/requests',                   [ADMIN, PROCUREMENT_MANAGER, BRANCH_MANAGER, PRODUCTION_MANAGER, ACCOUNTING]],
  ['POST',   '/api/purchase-requests',                  [ADMIN, PROCUREMENT_MANAGER, BRANCH_MANAGER, PRODUCTION_MANAGER, ACCOUNTING]],
  ['GET',    '/procurement/orders',                     [ADMIN, PROCUREMENT_MANAGER, ACCOUNTING]],
  ['POST',   '/api/purchase-orders/po1/submit',         [ADMIN, PROCUREMENT_MANAGER, ACCOUNTING]],
  ['GET',    '/procurement/receiving',                  [ADMIN, PROCUREMENT_MANAGER, ACCOUNTING]],
  ['GET',    '/procurement/receiving/new',              [ADMIN, PROCUREMENT_MANAGER]],
  ['POST',   '/api/receiving-reports',                  [ADMIN, PROCUREMENT_MANAGER]],

  // Production
  ['GET',    '/production/orders',                      [ADMIN, PRODUCTION_MANAGER, ACCOUNTING]],
  ['GET',    '/production/orders/new',                  [ADMIN, PRODUCTION_MANAGER]],
  ['GET',    '/production/bom',                         [ADMIN, PRODUCTION_MANAGER]],
  ['POST',   '/api/production-orders',                  [ADMIN, PRODUCTION_MANAGER]],
  ['POST',   '/api/production/simulate',                [ADMIN, PRODUCTION_MANAGER, ACCOUNTING]],
  ['GET',    '/production/conversions/new',             [ADMIN, PRODUCTION_MANAGER]],
  ['POST',   '/api/conversion-orders',                  [ADMIN, PRODUCTION_MANAGER]],

  // Inventory
  ['GET',    '/inventory/transfers',                    [ADMIN, PRODUCTION_MANAGER, ACCOUNTING, BRANCH_MANAGER]],
  ['GET',    '/inventory/transfers/new',                [ADMIN, PRODUCTION_MANAGER]],
  // Under /inventory/transfers too: both guards apply, so only the roles in both.
  ['GET',    '/inventory/transfers/return',             [ADMIN, BRANCH_MANAGER]],
  ['POST',   '/api/transfers',                          [ADMIN, PRODUCTION_MANAGER, BRANCH_MANAGER]],
  ['GET',    '/inventory/receive',                      [ADMIN, PRODUCTION_MANAGER, BRANCH_MANAGER]],
  ['GET',    '/inventory/requests/new',                 [ADMIN, BRANCH_MANAGER]],
  ['POST',   '/api/stock-requests',                     [ADMIN, PRODUCTION_MANAGER, BRANCH_MANAGER]],
  ['GET',    '/inventory/sales/new',                    [ADMIN, BRANCH_MANAGER]],
  ['POST',   '/api/outlet-sales',                       [ADMIN, BRANCH_MANAGER]],
  ['GET',    '/inventory/write-offs/new',               [ADMIN, PRODUCTION_MANAGER]],
  ['POST',   '/api/write-offs',                         [ADMIN, PRODUCTION_MANAGER]],
  ['GET',    '/inventory/stock',                        EVERYONE],

  // Item master: read by every module, written by ADMIN only.
  ['GET',    '/api/materials',                          EVERYONE],
  ['POST',   '/api/materials',                          [ADMIN]],
  ['PUT',    '/api/materials/m1',                       [ADMIN]],
  ['POST',   '/api/materials/m1/prices',                [ADMIN]],
  ['DELETE', '/api/finished-goods/f1',                  [ADMIN]],
  ['PATCH',  '/api/categories/c1',                      [ADMIN]],
  ['POST',   '/api/units',                              [ADMIN]],
  ['GET',    '/api/branches',                           EVERYONE],
  ['POST',   '/api/branches/b1/deactivate',             [ADMIN]],
  ['GET',    '/api/boms',                               EVERYONE],
  ['POST',   '/api/boms',                               [ADMIN, PRODUCTION_MANAGER]],
  // No method list: reads are ADMIN-only too.
  ['GET',    '/api/suppliers',                          [ADMIN]],
  ['GET',    '/api/holidays',                           [ADMIN]],

  // Admin and accounts
  ['POST',   '/api/auth/register',                      [ADMIN]],
  ['GET',    '/admin/users',                            [ADMIN]],
  ['POST',   '/api/email/test',                         [ADMIN]],

  // AI: the test button spends real money; the assistant reads across branches.
  ['POST',   '/api/ai/test',                            [ADMIN]],
  ['POST',   '/api/ai/assistant',                       [ADMIN, ACCOUNTING, PRODUCTION_MANAGER]],
  ['POST',   '/api/ai/insights',                        [ADMIN, PRODUCTION_MANAGER, ACCOUNTING, PROCUREMENT_MANAGER]],

  // Read-only views
  ['GET',    '/costing',                                [ADMIN, ACCOUNTING, PRODUCTION_MANAGER, VIEWER]],
  ['GET',    '/reports',                                EVERYONE],
  ['GET',    '/api/reports/inventory-movement',         EVERYONE],
  ['GET',    '/dashboard',                              EVERYONE],
  ['GET',    '/api/notifications',                      EVERYONE],
]

describe('who may reach what', () => {
  it.each(ACCESS)('%s %s', async (method, path, allowed) => {
    // Collect every role's answer first, so a failure lists all the wrong ones at once.
    const wrong: string[] = []
    for (const role of EVERYONE) {
      const got = outcome(await send(path, { role, method }))
      const expected = allowed.includes(role) ? 'allowed' : 'refused'
      const actual = got === 'allowed' ? 'allowed' : 'refused'
      if (actual !== expected) wrong.push(`${role}: expected ${expected}, got ${got}`)
    }
    expect(wrong).toEqual([])
  })

  it('lets exactly the assistant’s roles reach the assistant (kept in step with ASSISTANT_ROLES)', async () => {
    for (const role of EVERYONE) {
      const got = outcome(await send('/api/ai/assistant', { role, method: 'POST' }))
      expect(got === 'allowed', role).toBe(ASSISTANT_ROLES.includes(role))
    }
  })
})

// ─── How a refusal looks ─────────────────────────────────────────────────────

describe('signed out', () => {
  it('sends a page to sign-in, remembering where it was going', async () => {
    const res = await send('/inventory/transfers/t1?scan=1')
    expect(outcome(res)).toBe('login')
    expect(new URL(res.headers.get('location')!).searchParams.get('next')).toBe('/inventory/transfers/t1?scan=1')
  })

  it('does not remember "/" or a form post', async () => {
    expect(new URL((await send('/')).headers.get('location')!).search).toBe('')
    expect(new URL((await send('/inventory/stock', { method: 'POST', navigate: true })).headers.get('location')!).search).toBe('')
  })

  it('answers an API call from code with 401 JSON, not a redirect a form would take for success', async () => {
    const res = await send('/api/purchase-requests', { method: 'POST' })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Your session has ended. Sign in again.' })
  })

  it('sends a download link the browser opened itself to sign-in', async () => {
    expect(outcome(await send('/api/purchase-orders/po1/pdf', { navigate: true }))).toBe('login')
  })

  it('lets the sign-in page and the login API through', async () => {
    expect(outcome(await send('/login'))).toBe('allowed')
    expect(outcome(await send('/api/auth/login', { method: 'POST' }))).toBe('allowed')
  })
})

describe('a token that cannot be trusted', () => {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET)

  it.each([
    ['garbage', async () => 'not-a-jwt'],
    ['signed with another secret', async () =>
      new SignJWT({ userId: 'u', email: 'e', role: ADMIN }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
        .setExpirationTime('1h').sign(new TextEncoder().encode('someone-elses-secret'))],
    ['expired', async () =>
      new SignJWT({ userId: 'u', email: 'e', role: ADMIN }).setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt(Math.floor(Date.now() / 1000) - 9 * 3600).setExpirationTime(Math.floor(Date.now() / 1000) - 3600).sign(secret)],
    ['a VIEWER token with its role edited to ADMIN', async () => {
      const [header, payload, signature] = (await tokenFor(VIEWER)).split('.')
      const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), role: ADMIN })).toString('base64url')
      return `${header}.${forged}.${signature}`
    }],
  ])('refuses a token that is %s, and clears the cookie', async (_label, make) => {
    const res = await send('/api/approvals', { method: 'POST', token: await make() })
    expect(outcome(res)).toBe(401)
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`${COOKIE_NAME}=;.*Max-Age=0`, 'i'))
  })
})

describe('a role that may not', () => {
  it('gets 403 JSON from an API call', async () => {
    const res = await send('/api/approvals', { role: VIEWER, method: 'POST' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Your role cannot do this.' })
  })

  it('is sent to /unauthorized from a page', async () => {
    expect(outcome(await send('/procurement/approvals', { role: BRANCH_MANAGER }))).toBe('unauthorized')
  })
})

describe('who the route handlers are told the user is', () => {
  it('forwards the identity from the verified token', async () => {
    const res = await send('/api/purchase-requests', { role: PROCUREMENT_MANAGER, method: 'POST' })
    expect(res.headers.get('x-middleware-request-x-user-id')).toBe(`user-${PROCUREMENT_MANAGER}`)
    expect(res.headers.get('x-middleware-request-x-user-role')).toBe(PROCUREMENT_MANAGER)
    expect(res.headers.get('x-middleware-request-x-user-email')).toBe('procurement_manager@test.local')
  })

  it('overwrites identity headers a caller sends itself', async () => {
    const res = await send('/api/notifications', {
      role: VIEWER,
      headers: { 'x-user-id': 'someone-else', 'x-user-role': ADMIN, 'x-user-email': 'boss@test.local' },
    })
    expect(res.headers.get('x-middleware-request-x-user-id')).toBe(`user-${VIEWER}`)
    expect(res.headers.get('x-middleware-request-x-user-role')).toBe(VIEWER)
    expect(res.headers.get('x-middleware-request-x-user-email')).toBe('viewer@test.local')
  })

  it('still checks the role from the token, not a spoofed header', async () => {
    const res = await send('/api/approvals', { role: VIEWER, method: 'POST', headers: { 'x-user-role': ADMIN } })
    expect(outcome(res)).toBe(403)
  })
})
