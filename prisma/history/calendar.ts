import { addDays } from '@/lib/dates'

/**
 * Business-calendar helpers for the history. Dates are YYYY-MM-DD in Manila
 * (lib/dates.ts); a moment is that date at a Manila clock time.
 */

/** A Manila clock time on a date, plus `minutes` (may push into the next day). */
export function at(date: string, time: string, minutes = 0): Date {
  return new Date(new Date(`${date}T${time}:00+08:00`).getTime() + Math.round(minutes) * 60_000)
}

/** Midnight UTC of a business date — how date-only columns (plannedDate, neededOn, expectedDelivery) are stored. */
export function dateOnly(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

export function eachDay(from: string, to: string): string[] {
  const days: string[] = []
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day)
  return days
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * Philippine regular holidays and special non-working days, 2026 — the days
 * the history's demand rises on. Task 5's Holiday table is pre-filled with
 * the same days, so the Demand Forecaster can find the effect in the history.
 */
export const PH_HOLIDAYS_2026: { date: string; name: string }[] = [
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-02-17', name: 'Chinese New Year' },
  { date: '2026-04-02', name: 'Maundy Thursday' },
  { date: '2026-04-03', name: 'Good Friday' },
  { date: '2026-04-04', name: 'Black Saturday' },
  { date: '2026-04-09', name: 'Araw ng Kagitingan' },
  { date: '2026-05-01', name: 'Labor Day' },
  { date: '2026-06-12', name: 'Independence Day' },
  { date: '2026-08-21', name: 'Ninoy Aquino Day' },
  { date: '2026-08-31', name: 'National Heroes Day' },
  { date: '2026-11-01', name: "All Saints' Day" },
  { date: '2026-11-02', name: "All Souls' Day" },
  { date: '2026-11-30', name: 'Bonifacio Day' },
  { date: '2026-12-08', name: 'Feast of the Immaculate Conception' },
  { date: '2026-12-24', name: 'Christmas Eve' },
  { date: '2026-12-25', name: 'Christmas Day' },
  { date: '2026-12-30', name: 'Rizal Day' },
  { date: '2026-12-31', name: 'Last Day of the Year' },
]

const HOLIDAY_DATES = new Set(PH_HOLIDAYS_2026.map(h => h.date))

export function isHoliday(date: string): boolean {
  return HOLIDAY_DATES.has(date)
}
