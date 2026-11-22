import { isHoliday, weekday } from './calendar'

/**
 * What each outlet sells, per finished good, per day — the demand model the
 * whole history follows (Week 10 Task 1). Purchasing plans from its expected
 * value; outlet orders (subtask 1.3) add day-to-day noise around it.
 *
 * The patterns built in here are listed in the change note, so the Demand
 * Forecaster's suggestions can be checked against them.
 */

export const GOOD_CODES = ['FG-LECHON', 'FG-DINUGUAN', 'FG-BOPIS', 'FG-LECHON-PAKSIW'] as const
export type GoodCode = (typeof GOOD_CODES)[number]

/** kg sold on an ordinary Monday–Thursday. */
const BASE_DEMAND: Record<string, Record<GoodCode, number>> = {
  CUB: { 'FG-LECHON': 16, 'FG-DINUGUAN': 5, 'FG-BOPIS': 4, 'FG-LECHON-PAKSIW': 4 },
  MKT: { 'FG-LECHON': 14, 'FG-DINUGUAN': 6, 'FG-BOPIS': 5, 'FG-LECHON-PAKSIW': 3 },
  ALB: { 'FG-LECHON': 18, 'FG-DINUGUAN': 4, 'FG-BOPIS': 3, 'FG-LECHON-PAKSIW': 5 },
}

/** Sunday … Saturday: weekends sell the most lechon. */
const WEEKDAY_FACTOR = [1.5, 0.9, 0.9, 0.95, 1.0, 1.15, 1.4]

/** On a holiday families buy lechon; the viands rise less. */
const HOLIDAY_FACTOR: Record<GoodCode, number> = {
  'FG-LECHON': 1.8, 'FG-DINUGUAN': 1.3, 'FG-BOPIS': 1.3, 'FG-LECHON-PAKSIW': 1.3,
}

/** The kitchen each outlet usually orders from (it may order from any). */
export const HOME_KITCHEN: Record<string, string> = { CUB: 'MAIN', MKT: 'PSG', ALB: 'LPS' }

/** Expected kg sold — no noise. */
export function expectedDemand(outletCode: string, good: GoodCode, date: string): number {
  const base = BASE_DEMAND[outletCode]?.[good] ?? 0
  return base * WEEKDAY_FACTOR[weekday(date)] * (isHoliday(date) ? HOLIDAY_FACTOR[good] : 1)
}
