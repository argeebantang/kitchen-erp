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
 * Display-only peso formatting. Safe to go through Number here because the
 * authoritative value stays the string — all arithmetic happened server-side in
 * Decimal, and this only rounds for presentation. Never feed the result back
 * into a calculation.
 */
export function formatPeso(value: string): string {
  return `₱${Number(value).toFixed(2)}`
}
