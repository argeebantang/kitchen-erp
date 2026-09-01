import bcrypt from 'bcryptjs'

/**
 * Node-runtime auth helpers. bcryptjs cannot run in the Edge runtime, so this
 * module must never be imported from middleware.ts — see lib/jwt.ts, which
 * holds the Edge-safe JWT half and is what middleware imports.
 *
 * The JWT helpers are re-exported here so Node-side callers (services, server
 * components) can keep importing everything auth-related from one place.
 */
export { COOKIE_NAME, signToken, verifyToken } from './jwt'
export type { JWTPayload } from './jwt'

const BCRYPT_ROUNDS = 12

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
