import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { config } from './config'

const BCRYPT_ROUNDS = 12
const JWT_ALGORITHM = 'HS256'
const JWT_EXPIRY = '8h'
const COOKIE_NAME = 'kitchen-token'

// TextEncoder converts the string secret into bytes that jose requires
const secret = new TextEncoder().encode(config.jwtSecret)

export { COOKIE_NAME }

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

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

// We always run this even if the user doesn't exist (timing attack prevention)
// A timing attack is when an attacker measures response time to figure out
// if an email is registered — running bcrypt regardless neutralizes that
const DUMMY_HASH = '$2a$12$dummy.hash.to.prevent.timing.attacks.padding00000000'

export async function verifyPassword(
  password: string,
  hash: string | null
): Promise<boolean> {
  const result = await bcrypt.compare(password, hash ?? DUMMY_HASH)
  return hash !== null && result
}
