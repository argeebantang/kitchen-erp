/**
 * Business-calendar dates. Runtime-neutral, like lib/format.ts: no Prisma, no
 * 'use client', so pages, services and Client Components can all import it.
 */

/** The kitchen's timezone. The server clock is UTC. */
export const BUSINESS_TIME_ZONE = 'Asia/Manila'

/**
 * Today as YYYY-MM-DD in the kitchen's timezone. A plain
 * new Date().toISOString() gives the UTC date, which is still yesterday in
 * Manila before 8am.
 */
export function todayIsoDate(): string {
  return isoDateAt(new Date())
}

/** A moment as the kitchen reads it, in Manila time: "Nov 12, 3:00 PM". */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', {
    timeZone: BUSINESS_TIME_ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

/** The business date (YYYY-MM-DD, Asia/Manila) of a moment — e.g. the day a run was reported done. */
export function isoDateAt(moment: Date): string {
  // en-CA is the locale whose short date format is YYYY-MM-DD.
  return moment.toLocaleDateString('en-CA', { timeZone: BUSINESS_TIME_ZONE })
}

/** A calendar month as YYYY-MM, e.g. the schedule's ?month=. */
export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * Calendar arithmetic on date labels. Dates here are business-calendar days
 * (stored as UTC midnight, docs/database.md), so the maths runs in UTC on
 * purpose: a date label has no time to shift. "Today" still comes from
 * todayIsoDate(), which is where the kitchen's timezone matters.
 */
function monthParts(month: string): [number, number] {
  const [year, monthNumber] = month.split('-').map(Number)
  return [year, monthNumber - 1]
}

/** The month `count` months after (or before, if negative) a YYYY-MM month. */
export function addMonths(month: string, count: number): string {
  const [year, monthIndex] = monthParts(month)
  return new Date(Date.UTC(year, monthIndex + count, 1)).toISOString().slice(0, 7)
}

/** "November 2026". */
export function monthLabel(month: string): string {
  const [year, monthIndex] = monthParts(month)
  return new Date(Date.UTC(year, monthIndex, 1))
    .toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/**
 * The weeks a month calendar shows: whole Sunday-to-Saturday weeks covering
 * the month, so the first and last weeks carry days of the neighbouring
 * months. Each day is YYYY-MM-DD. Four to six weeks.
 */
export function monthGrid(month: string): string[][] {
  const [year, monthIndex] = monthParts(month)
  const first = new Date(Date.UTC(year, monthIndex, 1))
  const last  = new Date(Date.UTC(year, monthIndex + 1, 0))
  const day   = new Date(Date.UTC(year, monthIndex, 1 - first.getUTCDay()))
  const end   = Date.UTC(year, monthIndex, last.getUTCDate() + (6 - last.getUTCDay()))

  const weeks: string[][] = []
  while (day.getTime() <= end) {
    const week: string[] = []
    for (let i = 0; i < 7; i += 1) {
      week.push(day.toISOString().slice(0, 10))
      day.setUTCDate(day.getUTCDate() + 1)
    }
    weeks.push(week)
  }
  return weeks
}

/**
 * Lots are flagged when they have this many hours or fewer left (Week 7 Task 3,
 * X1): within 24 h — use or convert today; within 48 h — plan for it. Fixed
 * for every finished good, as in the roadmap: Lechon (48 h shelf life) is
 * "within 48 h" from the moment it is roasted, which is right for it.
 */
export const EXPIRY_URGENT_HOURS = 24
export const EXPIRY_SOON_HOURS   = 48

export type ExpiryStatus = 'EXPIRED' | 'WITHIN_24H' | 'WITHIN_48H' | 'OK'

/** A lot's expiry as of one moment: its status and the whole minutes left (negative once expired). */
export type ExpiryFlag = { status: ExpiryStatus; minutesLeft: number }

/**
 * The flag for an expiry, against `now` (ms). Callers pass one clock for a
 * whole page or job, so two lots expiring together never read differently.
 * Null for a lot with no expiry (made before expiry was tracked).
 */
export function expiryFlag(expiresAt: Date | string | null, now: number): ExpiryFlag | null {
  if (expiresAt === null) return null
  // The status is decided to the millisecond, like a lot's `expired` flag, so
  // the two never disagree in a lot's last minute; minutes are for display.
  const msLeft = new Date(expiresAt).getTime() - now
  const hour   = 60 * 60 * 1000
  const status: ExpiryStatus = msLeft <= 0
    ? 'EXPIRED'
    : msLeft <= EXPIRY_URGENT_HOURS * hour
      ? 'WITHIN_24H'
      : msLeft <= EXPIRY_SOON_HOURS * hour ? 'WITHIN_48H' : 'OK'
  return { status, minutesLeft: Math.floor(msLeft / 60_000) }
}

/** "40 min", "5 h", "30 h" — how long is left, for a badge. */
export function formatTimeLeft(minutesLeft: number): string {
  return minutesLeft < 60 ? `${Math.max(minutesLeft, 0)} min` : `${Math.floor(minutesLeft / 60)} h`
}

/**
 * The span of one business day (YYYY-MM-DD) as instants: Manila midnight to
 * the next Manila midnight, end exclusive. Manila is UTC+8 all year — the
 * Philippines has no daylight saving — so a fixed offset is exact. For
 * reading the ledger by day (End of Day, Week 7 Task 4).
 */
export function businessDayRange(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00+08:00`)
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) }
}

/** The business date `days` after (or before, if negative) a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const moment = new Date(`${date}T00:00:00Z`)
  moment.setUTCDate(moment.getUTCDate() + days)
  return moment.toISOString().slice(0, 10)
}
