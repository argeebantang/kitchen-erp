import { cookies } from 'next/headers'
import { verifyToken, COOKIE_NAME, JWTPayload } from '@/lib/auth'

// Server-only helper — reads the auth cookie and verifies it.
// Returns the JWT payload if valid, null if missing/expired/tampered.
export async function getSession(): Promise<JWTPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value

  if (!token) return null

  return verifyToken(token)
}
