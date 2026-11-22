import { addDays, businessDayRange, todayIsoDate } from '@/lib/dates'
import { SupplierRepository } from '@/repositories/supplier.repository'

/**
 * Suppliers and their lead times (Week 10 Task 3, docs/2026-11-23-week10-supplier-performance.md).
 *
 * The lead time a reorder plans with (gap 1 of the Week 10 plan, "both, with a
 * fallback"):
 *   1. measured — the median days from an approved order to its first
 *      delivery, over the last LEAD_TIME_LOOKBACK_DAYS, once the supplier has
 *      at least LEAD_TIME_MIN_SAMPLES delivered orders: what it really does;
 *   2. promised — Supplier.leadTimeDays, set in Master Data;
 *   3. DEFAULT_LEAD_TIME_DAYS.
 * The source travels with the figure, so a page can say where it came from.
 */

export const LEAD_TIME_LOOKBACK_DAYS = 180
export const LEAD_TIME_MIN_SAMPLES = 3
export const DEFAULT_LEAD_TIME_DAYS = 2
export const MAX_LEAD_TIME_DAYS = 60

export type LeadTimeSource = 'measured' | 'promised' | 'default'

export type SupplierLeadTime = {
  /** What a reorder plans with. */
  days: number
  source: LeadTimeSource
  promisedDays: number | null
  measuredDays: number | null
  /** Delivered orders the measurement is over. */
  measuredOrders: number
}

export type SupplierDto = {
  id: string
  name: string
  contactName: string | null
  phone: string | null
  isActive: boolean
  leadTime: SupplierLeadTime
}

export type SupplierResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status: number }

function leadTimeOf(promised: number | null, measured: { samples: number; median: number } | undefined): SupplierLeadTime {
  const measuredDays = measured ? measured.median : null
  const measuredOrders = measured?.samples ?? 0
  if (measured && measured.samples >= LEAD_TIME_MIN_SAMPLES) {
    return { days: measured.median, source: 'measured', promisedDays: promised, measuredDays, measuredOrders }
  }
  if (promised !== null) return { days: promised, source: 'promised', promisedDays: promised, measuredDays, measuredOrders }
  return { days: DEFAULT_LEAD_TIME_DAYS, source: 'default', promisedDays: null, measuredDays, measuredOrders }
}

async function measured(): Promise<Map<string, { samples: number; median: number }>> {
  const since = businessDayRange(addDays(todayIsoDate(), -LEAD_TIME_LOOKBACK_DAYS)).start
  const rows = await SupplierRepository.measuredLeadTimes(since)
  return new Map(rows.map(row => [row.supplierId, { samples: Number(row.samples), median: Number(row.median) }]))
}

export const SupplierService = {
  /** Every supplier with its lead time, for Master Data → Suppliers. */
  async list(): Promise<SupplierDto[]> {
    const [suppliers, measuredBy] = await Promise.all([SupplierRepository.findAll(), measured()])
    return suppliers.map(supplier => ({
      id: supplier.id, name: supplier.name, contactName: supplier.contactName, phone: supplier.phone, isActive: supplier.isActive,
      leadTime: leadTimeOf(supplier.leadTimeDays, measuredBy.get(supplier.id)),
    }))
  },

  /** The lead time per supplier id — what the Reorder Recommender (Task 4) and the supplier report use. */
  async leadTimes(): Promise<Map<string, SupplierLeadTime>> {
    const [suppliers, measuredBy] = await Promise.all([SupplierRepository.findAll(), measured()])
    return new Map(suppliers.map(supplier => [supplier.id, leadTimeOf(supplier.leadTimeDays, measuredBy.get(supplier.id))]))
  },

  /** The lead time for a material with no supplier on record: the default. */
  defaultLeadTime(): SupplierLeadTime {
    return leadTimeOf(null, undefined)
  },

  /** Sets or clears the promised lead time: whole days, 1 to MAX_LEAD_TIME_DAYS. */
  async setLeadTime(id: string, leadTimeDays: number | null): Promise<SupplierResult<{ id: string; leadTimeDays: number | null }>> {
    if (leadTimeDays !== null && (!Number.isInteger(leadTimeDays) || leadTimeDays < 1 || leadTimeDays > MAX_LEAD_TIME_DAYS)) {
      return { success: false, error: `The lead time is whole days from 1 to ${MAX_LEAD_TIME_DAYS}, or empty`, status: 400 }
    }
    if (!(await SupplierRepository.setLeadTime(id, leadTimeDays))) {
      return { success: false, error: 'Supplier not found', status: 404 }
    }
    return { success: true, data: { id, leadTimeDays } }
  },
}
