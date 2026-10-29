/**
 * Business-calendar dates. Runtime-neutral, like lib/format.ts: no Prisma, no
 * 'use client', so pages, services and Client Components can all import it.
 */

/** The kitchen's timezone. The server clock is UTC. */
const BUSINESS_TIME_ZONE = 'Asia/Manila'

/**
 * Today as YYYY-MM-DD in the kitchen's timezone. A plain
 * new Date().toISOString() gives the UTC date, which is still yesterday in
 * Manila before 8am.
 */
export function todayIsoDate(): string {
  // en-CA is the locale whose short date format is YYYY-MM-DD.
  return new Date().toLocaleDateString('en-CA', { timeZone: BUSINESS_TIME_ZONE })
}
