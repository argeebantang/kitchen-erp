import { afterEach, describe, expect, it, vi } from 'vitest'
import { periodDays, periodLabel, presetPeriod } from '@/services/report.service'
import { isLate } from '@/services/stock-request.service'

describe('presetPeriod — Manila calendar, weeks Monday to Sunday', () => {
  it('works from a Saturday mid-month', () => {
    const today = '2026-11-28'
    expect(presetPeriod('this-week', today)).toEqual({ from: '2026-11-23', to: '2026-11-28' })
    expect(presetPeriod('last-week', today)).toEqual({ from: '2026-11-16', to: '2026-11-22' })
    expect(presetPeriod('this-month', today)).toEqual({ from: '2026-11-01', to: '2026-11-28' })
    expect(presetPeriod('last-month', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
  })

  it('reaches back into last year in early January', () => {
    const today = '2026-01-02'
    expect(presetPeriod('this-week', today)).toEqual({ from: '2025-12-29', to: '2026-01-02' })
    expect(presetPeriod('last-week', today)).toEqual({ from: '2025-12-22', to: '2025-12-28' })
    expect(presetPeriod('last-month', today)).toEqual({ from: '2025-12-01', to: '2025-12-31' })
  })

  it('ends last month on the right day of February', () => {
    expect(presetPeriod('last-month', '2026-03-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(presetPeriod('last-month', '2028-03-01')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })
})

describe('periodDays / periodLabel', () => {
  it('counts days inclusively', () => {
    expect(periodDays('2026-11-23', '2026-11-23')).toBe(1)
    expect(periodDays('2026-11-01', '2026-11-30')).toBe(30)
    expect(periodDays('2028-02-01', '2028-03-01')).toBe(30)
  })

  it('labels one day, a week and a period across years', () => {
    expect(periodLabel('2026-11-23', '2026-11-23')).toBe('Mon, Nov 23, 2026')
    expect(periodLabel('2026-11-16', '2026-11-22')).toBe('Mon, Nov 16 – Sun, Nov 22, 2026')
    expect(periodLabel('2025-12-29', '2026-01-04')).toBe('Mon, Dec 29, 2025 – Sun, Jan 4, 2026')
  })
})

describe('isLate — a stock request after the cut-off on the day before', () => {
  const cutoff = '15:00'
  const neededOn = '2026-11-30'

  afterEach(() => {
    vi.useRealTimers()
  })

  // isLate reads today from the clock and the time of day from `now`; keep them one moment.
  function lateAt(iso: string): boolean {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(iso))
    return isLate(neededOn, new Date(), cutoff)
  }

  it('is on time two days ahead', () => {
    expect(lateAt('2026-11-28T10:00:00+08:00')).toBe(false)
  })

  it('is on time the day before, until the cut-off', () => {
    expect(lateAt('2026-11-29T14:59:00+08:00')).toBe(false)
  })

  it('is late from the cut-off minute', () => {
    expect(lateAt('2026-11-29T15:00:00+08:00')).toBe(true)
  })

  it('is late on the day itself, and after', () => {
    expect(lateAt('2026-11-30T06:00:00+08:00')).toBe(true)
    expect(lateAt('2026-12-01T09:00:00+08:00')).toBe(true)
  })

  it('reads the day and the cut-off in Manila, not UTC', () => {
    // 23:30 UTC on the 28th is 07:30 on the 29th in Manila: the day before, before the cut-off.
    expect(lateAt('2026-11-28T23:30:00Z')).toBe(false)
    // 07:00 UTC on the 29th is 15:00 in Manila: the cut-off.
    expect(lateAt('2026-11-29T07:00:00Z')).toBe(true)
  })
})
