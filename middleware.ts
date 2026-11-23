import { NextRequest, NextResponse } from 'next/server'
// Imported from lib/jwt, NOT lib/auth: lib/auth pulls in bcryptjs, which the
// Edge runtime cannot execute. See the note in lib/jwt.ts.
import { verifyToken, COOKIE_NAME } from '@/lib/jwt'
// Type-only import — erased at compile time, so the Prisma client never enters
// the Edge bundle either.
import type { Role } from '@prisma/client'

// Paths that never require a token
// /api/auth/register is deliberately absent: it lets the caller choose any
// role, so it is ADMIN-only below rather than public.
const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
]

// Requests that change data. A guard limited to these leaves reads open to
// every signed-in user — the item master is read across modules, but only the
// roles that own it may change it.
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

// Paths that require a specific role.
// Kept in sync with the role restrictions in lib/navigation.ts — the sidebar
// hides links a role can't use, but this is what actually blocks the URL.
//
// The loop below checks EVERY matching guard, not just the first — so overlapping
// prefixes are AND-ed. Procurement relies on that: `/procurement` sets the
// baseline (any procurement role, no VIEWER), then the narrower guards further
// restrict specific sub-paths.
//
// A guard with `methods` applies only to those HTTP methods; without it, to all.
const ROLE_GUARDS: { path: string; roles: Role[]; methods?: string[] }[] = [
  { path: '/procurement',           roles: ['ADMIN', 'PROCUREMENT_MANAGER', 'BRANCH_MANAGER', 'PRODUCTION_MANAGER', 'ACCOUNTING'] },
  { path: '/procurement/orders',    roles: ['ADMIN', 'PROCUREMENT_MANAGER', 'ACCOUNTING'] },
  { path: '/procurement/approvals', roles: ['ADMIN', 'ACCOUNTING'] },
  // Accounting reads receiving reports to approve them (the decision itself
  // goes through /api/approvals); only procurement records a delivery. The
  // edit page, /procurement/receiving/[id]/edit, cannot be matched by a prefix,
  // so it checks the role itself.
  { path: '/procurement/receiving', roles: ['ADMIN', 'PROCUREMENT_MANAGER', 'ACCOUNTING'] },
  { path: '/procurement/receiving/new', roles: ['ADMIN', 'PROCUREMENT_MANAGER'] },
  { path: '/api/purchase-requests', roles: ['ADMIN', 'PROCUREMENT_MANAGER', 'BRANCH_MANAGER', 'PRODUCTION_MANAGER', 'ACCOUNTING'] },
  { path: '/api/purchase-orders',   roles: ['ADMIN', 'PROCUREMENT_MANAGER', 'ACCOUNTING'] },
  { path: '/api/approvals',         roles: ['ADMIN', 'ACCOUNTING'] },
  { path: '/api/receiving-reports', roles: ['ADMIN', 'PROCUREMENT_MANAGER'] },
  { path: '/api/auth/register',     roles: ['ADMIN'] },
  // Item master: written from /admin/master, so ADMIN only. Covers
  // /api/materials/[id]/prices through the /api/materials prefix.
  { path: '/api/materials',         roles: ['ADMIN'], methods: WRITE_METHODS },
  { path: '/api/finished-goods',    roles: ['ADMIN'], methods: WRITE_METHODS },
  { path: '/api/categories',        roles: ['ADMIN'], methods: WRITE_METHODS },
  { path: '/api/units',             roles: ['ADMIN'], methods: WRITE_METHODS },
  // Branches (Week 8 Task 1): read by later forms, managed in Master Data.
  { path: '/api/branches',          roles: ['ADMIN'], methods: WRITE_METHODS },
  // Master Data → Suppliers (Week 10 Task 3): the promised lead time.
  { path: '/api/suppliers',         roles: ['ADMIN'] },
  // Master Data → Holidays (Week 10 Task 5): the calendar the Demand Forecaster reads.
  { path: '/api/holidays',          roles: ['ADMIN'] },
  // BOMs belong to production, same roles as the /production pages.
  { path: '/api/boms',              roles: ['ADMIN', 'PRODUCTION_MANAGER'], methods: WRITE_METHODS },
  // Accounting reads production orders to approve them (the decision itself
  // goes through /api/approvals); only production plans them or touches BOMs.
  // The edit page, /production/orders/[id]/edit, cannot be matched by a
  // prefix, so it checks the role itself.
  { path: '/production',            roles: ['ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTING'] },
  { path: '/production/bom',        roles: ['ADMIN', 'PRODUCTION_MANAGER'] },
  { path: '/production/orders/new', roles: ['ADMIN', 'PRODUCTION_MANAGER'] },
  { path: '/api/production-orders', roles: ['ADMIN', 'PRODUCTION_MANAGER'] },
  // The Decision Simulator (Week 10 Task 6): read-only what-if runs, from Production → Plan and Costing.
  { path: '/api/production/simulate', roles: ['ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTING'] },
  // Conversions (Week 7 Task 1): the same split — accounting reads
  // /production/conversions and decides through /api/approvals; only
  // production records one.
  { path: '/production/conversions/new', roles: ['ADMIN', 'PRODUCTION_MANAGER'] },
  { path: '/api/conversion-orders',      roles: ['ADMIN', 'PRODUCTION_MANAGER'] },
  // Transfers (Week 8 Task 2, T4): the kitchen records them; accounting reads
  // them and decides through /api/approvals; a branch manager reads their own
  // branch's and confirms receipt (Task 3, R5) — that narrowing is in
  // StockTransferService, not here. /api/transfers admits BRANCH_MANAGER for
  // /[id]/receive; creating and previewing re-check the role in their routes,
  // since a prefix guard cannot exclude a sub-path.
  { path: '/inventory/transfers',     roles: ['ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTING', 'BRANCH_MANAGER'] },
  { path: '/inventory/transfers/new', roles: ['ADMIN', 'PRODUCTION_MANAGER'] },
  // Returns (Week 9 Task 9): an outlet's manager sends unsold goods back to a
  // kitchen; StockTransferService checks it is their own outlet.
  { path: '/inventory/transfers/return', roles: ['ADMIN', 'BRANCH_MANAGER'] },
  // Stock requests (Week 9 Task 10): an outlet's manager asks a kitchen; the
  // kitchen plans or declines. StockRequestService scopes a branch manager to
  // their own outlet and checks who may do what.
  { path: '/inventory/requests',     roles: ['ADMIN', 'PRODUCTION_MANAGER', 'BRANCH_MANAGER'] },
  { path: '/inventory/requests/new', roles: ['ADMIN', 'BRANCH_MANAGER'] },
  { path: '/api/stock-requests',     roles: ['ADMIN', 'PRODUCTION_MANAGER', 'BRANCH_MANAGER'] },
  // Outlet daily sales (Week 10 Task 1): the outlet's manager records them; the
  // kitchen and accounting read them.
  { path: '/inventory/sales',          roles: ['ADMIN', 'ACCOUNTING', 'PRODUCTION_MANAGER', 'BRANCH_MANAGER'] },
  { path: '/inventory/sales/new',      roles: ['ADMIN', 'BRANCH_MANAGER'] },
  { path: '/api/outlet-sales',         roles: ['ADMIN', 'BRANCH_MANAGER'] },
  { path: '/api/transfers',           roles: ['ADMIN', 'PRODUCTION_MANAGER', 'BRANCH_MANAGER'] },
  // Write-offs (Week 7 Task 2, W7): production records them, accounting reads
  // them and decides through /api/approvals.
  { path: '/inventory/write-offs',     roles: ['ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTING'] },
  { path: '/inventory/write-offs/new', roles: ['ADMIN', 'PRODUCTION_MANAGER'] },
  { path: '/api/write-offs',           roles: ['ADMIN', 'PRODUCTION_MANAGER'] },
  // Week 8 Task 6 (C2): management's view of cost and loss.
  { path: '/costing',                  roles: ['ADMIN', 'ACCOUNTING', 'PRODUCTION_MANAGER', 'VIEWER'] },
  { path: '/admin',                 roles: ['ADMIN'] },
  // Week 11 Task 4: the roles with at least one report; which report each
  // may open is checked in ReportService (REPORTS[key].roles).
  { path: '/reports',               roles: ['ADMIN', 'ACCOUNTING', 'VIEWER', 'PRODUCTION_MANAGER', 'PROCUREMENT_MANAGER', 'BRANCH_MANAGER'] },
  { path: '/api/reports',           roles: ['ADMIN', 'ACCOUNTING', 'VIEWER', 'PRODUCTION_MANAGER', 'PROCUREMENT_MANAGER', 'BRANCH_MANAGER'] },
  // Week 9 Task 1 (D10): the Test connection button on AI Settings spends
  // real money. Each AI feature's own endpoint gets its own guard.
  { path: '/api/ai/test',           roles: ['ADMIN'] },
  // Week 11 Task 2: Admin → Email — the test email and who gets emails.
  { path: '/api/email',             roles: ['ADMIN'] },
  // Ask for / regenerate any AI insight (Week 10 Task 2; replaces Week 9's
  // /api/ai/cost-variance) — each type narrows its roles in AiInsightService.
  { path: '/api/ai/insights',       roles: ['ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTING', 'PROCUREMENT_MANAGER'] },
  // Week 9 Task 3 (F4): the dashboard assistant — ASSISTANT_ROLES in
  // services/assistant.service.ts. Its database login cannot narrow rows to
  // one branch, so roles that see only part of the data wait for that.
  { path: '/api/ai/assistant',      roles: ['ADMIN', 'ACCOUNTING', 'PRODUCTION_MANAGER'] },
]

/**
 * A refusal: a redirect for a page, JSON for an API call made from code.
 * fetch follows a redirect silently and gets a 200 HTML page back, which
 * forms took for success (Week 12 Task 2). A link the browser opens itself —
 * a PDF or Excel download under /api — still gets the page it can show.
 */
function refuse(req: NextRequest, status: 401 | 403): NextResponse {
  const isApiCall = req.nextUrl.pathname.startsWith('/api/') && req.headers.get('sec-fetch-mode') !== 'navigate'
  if (isApiCall) {
    return NextResponse.json(
      { error: status === 401 ? 'Your session has ended. Sign in again.' : 'Your role cannot do this.' },
      { status },
    )
  }
  return NextResponse.redirect(new URL(status === 401 ? '/login' : '/unauthorized', req.url))
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // 1. Let public paths through immediately
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // 2. Verify token
  const token = req.cookies.get(COOKIE_NAME)?.value

  if (!token) {
    return refuse(req, 401)
  }

  const payload = await verifyToken(token)

  if (!payload) {
    // Clear the invalid cookie and refuse
    const res = refuse(req, 401)
    res.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' })
    return res
  }

  // 3. Check role guards
  for (const guard of ROLE_GUARDS) {
    if (guard.methods && !guard.methods.includes(req.method)) continue
    if (pathname.startsWith(guard.path) && !guard.roles.includes(payload.role as Role)) {
      return refuse(req, 403)
    }
  }

  // 4. Forward user identity to route handlers via headers
  //    This means route handlers never need to re-verify the JWT
  const headers = new Headers(req.headers)
  headers.set('x-user-id',    payload.userId)
  headers.set('x-user-role',  payload.role)
  headers.set('x-user-email', payload.email)

  return NextResponse.next({ request: { headers } })
}

export const config = {
  // Run on all paths except Next.js internals and static files
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
