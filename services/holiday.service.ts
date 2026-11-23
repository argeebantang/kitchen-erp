import { HolidayType } from '@prisma/client'
import { todayIsoDate } from '@/lib/dates'
import { HolidayRepository, type HolidayRow } from '@/repositories/holiday.repository'

/**
 * Master Data → Holidays (Week 10 Task 5, gap 2 of the Week 10 plan): the days
 * the Demand Forecaster treats apart. Pre-filled with the 2026 Philippine
 * regular and special non-working days; an admin adds Eid'l Fitr / Eid'l Adha
 * when proclaimed, next year's list, and the business's own days (LOCAL).
 */

export type HolidayDto = HolidayRow

export const HOLIDAY_TYPE_LABELS: Record<HolidayType, string> = {
  REGULAR:             'Regular holiday',
  SPECIAL_NON_WORKING: 'Special non-working day',
  SPECIAL_WORKING:     'Special working day',
  LOCAL:               'Local (fiesta, event)',
}

export const HOLIDAY_NAME_MAX = 100

export type HolidayResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status: number }

export type HolidayInput = { date: string; name: string; type: HolidayType }

export const HolidayService = {
  /** One year's holidays, and every year that has any (this year always offered). */
  async list(year?: number): Promise<{ year: number; years: number[]; holidays: HolidayDto[] }> {
    const thisYear = Number(todayIsoDate().slice(0, 4))
    const shown = year ?? thisYear
    const [holidays, years] = await Promise.all([
      HolidayRepository.between(`${shown}-01-01`, `${shown}-12-31`),
      HolidayRepository.years(),
    ])
    const offered = [...new Set([...years, thisYear, thisYear + 1, shown])].sort((a, b) => b - a)
    return { year: shown, years: offered, holidays }
  },

  /** Holidays between two dates (YYYY-MM-DD), for the forecaster. */
  between(from: string, to: string): Promise<HolidayDto[]> {
    return HolidayRepository.between(from, to)
  },

  async create(input: HolidayInput): Promise<HolidayResult<HolidayDto>> {
    const created = await HolidayRepository.create({ ...input, name: input.name.trim() })
    return created
      ? { success: true, data: created }
      : { success: false, error: `${input.date} already has a holiday — edit that one instead`, status: 409 }
  },

  async update(id: string, input: HolidayInput): Promise<HolidayResult<HolidayDto>> {
    const updated = await HolidayRepository.update(id, { ...input, name: input.name.trim() })
    if (updated === null) return { success: false, error: 'Holiday not found', status: 404 }
    if (updated === 'TAKEN') return { success: false, error: `${input.date} already has a holiday`, status: 409 }
    return { success: true, data: updated }
  },

  async remove(id: string): Promise<HolidayResult<{ id: string }>> {
    return (await HolidayRepository.remove(id))
      ? { success: true, data: { id } }
      : { success: false, error: 'Holiday not found', status: 404 }
  },
}
