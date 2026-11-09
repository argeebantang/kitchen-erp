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
