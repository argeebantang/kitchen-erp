import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import { Role } from '@prisma/client'

// Paths that never require a token
const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/auth/register',
]

// Paths that require a specific role.
// Kept in sync with the role restrictions in lib/navigation.ts — the sidebar
// hides links a role can't use, but this is what actually blocks the URL.
const ROLE_GUARDS: { path: string; roles: Role[] }[] = [
  { path: '/procurement',         roles: ['ADMIN', 'PROCUREMENT_MANAGER'] },
  { path: '/production',          roles: ['ADMIN', 'PRODUCTION_MANAGER'] },
  { path: '/inventory/transfers', roles: ['ADMIN', 'BRANCH_MANAGER'] },
  { path: '/admin',               roles: ['ADMIN'] },
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
