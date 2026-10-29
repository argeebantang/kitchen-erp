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
  { path: '/procurement/receiving', roles: ['ADMIN', 'PROCUREMENT_MANAGER'] },
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
  // BOMs belong to production, same roles as the /production pages.
  { path: '/api/boms',              roles: ['ADMIN', 'PRODUCTION_MANAGER'], methods: WRITE_METHODS },
  { path: '/production',           roles: ['ADMIN', 'PRODUCTION_MANAGER'] },
  { path: '/inventory/transfers',   roles: ['ADMIN', 'BRANCH_MANAGER'] },
  { path: '/admin',                 roles: ['ADMIN'] },
]

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // 1. Let public paths through immediately
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // 2. Verify token
  const token = req.cookies.get(COOKIE_NAME)?.value

  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const payload = await verifyToken(token)

  if (!payload) {
    // Clear the invalid cookie and redirect
    const res = NextResponse.redirect(new URL('/login', req.url))
    res.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' })
    return res
  }

  // 3. Check role guards
  for (const guard of ROLE_GUARDS) {
    if (guard.methods && !guard.methods.includes(req.method)) continue
    if (pathname.startsWith(guard.path) && !guard.roles.includes(payload.role as Role)) {
      return NextResponse.redirect(new URL('/unauthorized', req.url))
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
