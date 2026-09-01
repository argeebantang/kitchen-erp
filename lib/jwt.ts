import { SignJWT, jwtVerify } from 'jose'
import { config } from './config'

/**
 * Edge-runtime-safe JWT helpers.
 *
 * This module exists separately from lib/auth.ts for one reason: middleware.ts
 * runs in the Edge runtime, which forbids code generation from strings. bcryptjs
 * (imported by lib/auth.ts for password hashing) uses exactly that, so importing
 * verifyToken from lib/auth.ts pulled bcrypt into the middleware bundle and
 * crashed it at runtime with:
 *
 *   EvalError: Code generation from strings disallowed for this context
 *
 * `next dev` tolerates it; `next build && next start` does not, so every
 * protected route 500s in production only. Keep this module free of bcrypt,
 * Prisma, and anything else Node-only — middleware imports from here.
 */

const JWT_ALGORITHM = 'HS256'
const JWT_EXPIRY    = '8h'

export const COOKIE_NAME = 'kitchen-token'

// TextEncoder converts the string secret into the bytes jose requires
const secret = new TextEncoder().encode(config.jwtSecret)

export type JWTPayload = {
  userId: string
  email: string
  role: string
  branchId?: string | null
}

export async function signToken(payload: JWTPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(secret)
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret)
    return payload as unknown as JWTPayload
  } catch {
    // Token expired, tampered with, or invalid — all treated the same way
    return null
  }
}
