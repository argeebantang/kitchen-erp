import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  businessDayRange,
  expiryFlag,
  formatTimeLeft,
  isoDateAt,
  isoWeekKey,
  monthGrid,
  timeOfDayAt,
  weekKeyStart,
  weekStartOf,
} from '@/lib/dates'

/** Business dates are Manila (UTC+8); the server clock is UTC. */

describe('isoDateAt / timeOfDayAt — Manila, not UTC', () => {
  it('is already the next day in Manila from 16:00 UTC', () => {
    expect(isoDateAt(new Date('2026-11-27T15:59:59Z'))).toBe('2026-11-27')
    expect(isoDateAt(new Date('2026-11-27T16:00:00Z'))).toBe('2026-11-28')
  })

  it('reads the clock in Manila, 24-hour', () => {
    expect(timeOfDayAt(new Date('2026-11-28T07:05:00Z'))).toBe('15:05')
    expect(timeOfDayAt(new Date('2026-11-27T16:00:00Z'))).toBe('00:00')
  })
})

describe('businessDayRange', () => {
  it('runs from Manila midnight to the next, end exclusive', () => {
    const { start, end } = businessDayRange('2026-11-28')
    expect(start.toISOString()).toBe('2026-11-27T16:00:00.000Z')
    expect(end.toISOString()).toBe('2026-11-28T16:00:00.000Z')
  })
})

describe('addDays / addMonths', () => {
  it('crosses month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
  })

  it('moves whole months either way', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-05', 0)).toBe('2026-05')
  })
})

describe('weekStartOf — weeks run Monday to Sunday', () => {
  it('gives the Monday for any day of the week', () => {
    expect(weekStartOf('2026-11-23')).toBe('2026-11-23') // Monday
    expect(weekStartOf('2026-11-28')).toBe('2026-11-23') // Saturday
    expect(weekStartOf('2026-11-29')).toBe('2026-11-23') // Sunday
  })

  it('crosses a year end', () => {
    expect(weekStartOf('2026-01-01')).toBe('2025-12-29')
  })
})

describe('isoWeekKey / weekKeyStart', () => {
  it('numbers weeks the ISO way', () => {
    expect(isoWeekKey('2026-11-28')).toBe('2026-W48')
    expect(isoWeekKey('2026-01-01')).toBe('2026-W01') // a Thursday: week 1 of 2026
  })

  it('puts a week in the year of its Thursday', () => {
    // 2027-01-01 is a Friday: its week's Thursday is 2026-12-31. 2026 has 53 weeks.
    expect(isoWeekKey('2027-01-01')).toBe('2026-W53')
  })

  it('turns a key back into its Monday', () => {
    expect(weekKeyStart('2026-W48')).toBe('2026-11-23')
    expect(weekKeyStart('2026-W53')).toBe('2026-12-28')
  })

  it('refuses a malformed key or a week the year does not have', () => {
    expect(weekKeyStart('2027-W53')).toBeNull()
    expect(weekKeyStart('2026-W00')).toBeNull()
    expect(weekKeyStart('2026-48')).toBeNull()
    expect(weekKeyStart('')).toBeNull()
  })
})

describe('monthGrid — Sunday-first wall calendar', () => {
  it('covers the month in whole weeks', () => {
    const weeks = monthGrid('2026-11') // Nov 1 2026 is a Sunday; Nov 30 a Monday
    expect(weeks).toHaveLength(5)
    expect(weeks[0][0]).toBe('2026-11-01')
    expect(weeks[4][6]).toBe('2026-12-05')
  })

  it('carries neighbouring months’ days in the first and last weeks', () => {
    const weeks = monthGrid('2026-12') // Dec 1 2026 is a Tuesday
    expect(weeks[0].slice(0, 2)).toEqual(['2026-11-29', '2026-11-30'])
    expect(weeks[0][2]).toBe('2026-12-01')
  })

  it('is exactly four weeks for a February that starts on Sunday', () => {
    expect(monthGrid('2026-02')).toHaveLength(4)
  })

  it('starts every week on a Sunday with seven consecutive days', () => {
    for (const month of ['2026-01', '2026-06', '2028-02']) {
      for (const week of monthGrid(month)) {
        expect(week).toHaveLength(7)
        expect(new Date(`${week[0]}T00:00:00Z`).getUTCDay()).toBe(0)
        expect(addDays(week[0], 6)).toBe(week[6])
      }
    }
  })
})

describe('expiryFlag', () => {
  const now = Date.parse('2026-11-28T00:00:00Z')
  const minute = 60_000
  const hour = 60 * minute

  it('has no flag for a lot without an expiry', () => {
    expect(expiryFlag(null, now)).toBeNull()
  })

  it('is expired at the exact moment, and after', () => {
    expect(expiryFlag(new Date(now), now)).toEqual({ status: 'EXPIRED', minutesLeft: 0 })
    expect(expiryFlag(new Date(now - 90_000), now)).toEqual({ status: 'EXPIRED', minutesLeft: -2 })
  })

  it('switches status on the millisecond at 24 h and 48 h', () => {
    expect(expiryFlag(new Date(now + 1), now)?.status).toBe('WITHIN_24H')
    expect(expiryFlag(new Date(now + 24 * hour), now)?.status).toBe('WITHIN_24H')
    expect(expiryFlag(new Date(now + 24 * hour + 1), now)?.status).toBe('WITHIN_48H')
    expect(expiryFlag(new Date(now + 48 * hour), now)?.status).toBe('WITHIN_48H')
    expect(expiryFlag(new Date(now + 48 * hour + 1), now)?.status).toBe('OK')
  })

  it('accepts an ISO string, as DTOs carry it', () => {
    expect(expiryFlag('2026-11-28T00:40:00Z', now)).toEqual({ status: 'WITHIN_24H', minutesLeft: 40 })
  })

  it('formats the time left for the badge', () => {
    expect(formatTimeLeft(40)).toBe('40 min')
    expect(formatTimeLeft(-5)).toBe('0 min')
    expect(formatTimeLeft(60)).toBe('1 h')
    expect(formatTimeLeft(30 * 60 + 59)).toBe('30 h')
  })
})
