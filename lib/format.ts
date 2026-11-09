/**
 * Display formatting for values that have already left the Decimal layer as
 * strings.
 *
 * This module is deliberately runtime-neutral: no 'use client' directive and no
 * Prisma import. Both matter.
 *
 * - A function exported from a 'use client' module and called in a Server
 *   Component becomes a client-reference proxy, and calling it throws
 *   "Attempted to call trimDecimal() from the server but trimDecimal is on the
 *   client". Neither `tsc` nor `next build` catches it — only a request does.
 * - Importing lib/decimal.ts (which imports Prisma) into a Client Component
 *   would pull @prisma/client into the browser bundle.
 *
 * So anything both sides format goes here.
 */

/**
 * Postgres returns DECIMAL(65,30), so 2.5 arrives as
 * "2.500000000000000000000000000000". Trims the zero tail without touching
 * significant digits.
 */
export function trimDecimal(value: string): string {
  if (!value.includes('.')) return value
  return value.replace(/\.?0+$/, '')
}

/**
 * Display-only peso formatting, rounded half up to the centavo. Never feed the
 * result back into a calculation — all arithmetic happens server-side in
 * Decimal.
 *
 * Rounds on the decimal digits rather than through Number(value).toFixed(2):
 * a binary float cannot hold most half-centavos exactly, so toFixed rounds
 * 3726.975 down to 3726.97 (found checking production costs, Week 6 Task 3).
 * Whole centavos stay far below 2^53, so the integer arithmetic is exact.
 */
export function formatPeso(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(value.trim())
  // Decimal writes very small or large values in exponent form (1e-7).
  if (!match) return `₱${Number(value).toFixed(2)}`

  const [, sign, whole, fraction = ''] = match
  const centavos = Number(whole) * 100 + Number((fraction + '00').slice(0, 2)) + (fraction.charAt(2) >= '5' ? 1 : 0)
  const digits   = String(centavos).padStart(3, '0')
  return `₱${centavos === 0 ? '' : sign}${digits.slice(0, -2)}.${digits.slice(-2)}`
}

/** A difference in pesos with its sign spelled out: "+₱80.54", "−₱12.00" (a true minus), "±₱0.00". */
export function formatSignedPeso(value: string): string {
  const amount = formatPeso(value.replace(/^-/, ''))
  if (amount === '₱0.00') return `±${amount}`
  return value.startsWith('-') ? `−${amount}` : `+${amount}`
}
