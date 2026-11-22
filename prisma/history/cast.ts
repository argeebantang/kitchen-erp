import { BranchType, Role } from '@prisma/client'

/**
 * Who and where the history happens (Week 10 Task 1,
 * docs/2026-11-22-week10-history-data.md).
 *
 * Every history document is made by one of HISTORY_STAFF — never by the
 * seed.ts users — so --clean finds all of it by its actor, with no marker in
 * any visible field. Their emails share HISTORY_EMAIL_DOMAIN.
 */

export const HISTORY_EMAIL_DOMAIN = 'history.kitchen.com'

/** Main Commissary comes from seed.ts; history adds two more kitchens and three outlets. */
export const MAIN_KITCHEN_CODE = 'MAIN'

export type HistoryBranch = { code: string; name: string; type: BranchType; address: string }

export const HISTORY_BRANCHES: HistoryBranch[] = [
  { code: 'PSG', name: 'Pasig Commissary',     type: BranchType.COMMISSARY, address: 'Kapitolyo, Pasig City' },
  { code: 'LPS', name: 'Las Piñas Commissary', type: BranchType.COMMISSARY, address: 'Alabang–Zapote Road, Las Piñas City' },
  { code: 'CUB', name: 'Cubao Outlet',         type: BranchType.OUTLET,     address: 'Gen. Romulo Ave, Cubao, Quezon City' },
  { code: 'MKT', name: 'Makati Outlet',        type: BranchType.OUTLET,     address: 'Chino Roces Ave, Makati City' },
  { code: 'ALB', name: 'Alabang Outlet',       type: BranchType.OUTLET,     address: 'Madrigal Ave, Alabang, Muntinlupa City' },
]

/** The staff key is how the simulation refers to a person; `manages` names an outlet by code. */
export type StaffKey = 'production' | 'accounting' | 'procurement' | 'cubao' | 'makati' | 'alabang'

export type HistoryStaff = { key: StaffKey; email: string; name: string; role: Role; manages?: string }

export const HISTORY_STAFF: HistoryStaff[] = [
  { key: 'production',  email: `rosa.delacruz@${HISTORY_EMAIL_DOMAIN}`,  name: 'Rosa Dela Cruz',  role: Role.PRODUCTION_MANAGER },
  { key: 'accounting',  email: `carmen.reyes@${HISTORY_EMAIL_DOMAIN}`,   name: 'Carmen Reyes',    role: Role.ACCOUNTING },
  { key: 'procurement', email: `nestor.garcia@${HISTORY_EMAIL_DOMAIN}`,  name: 'Nestor Garcia',   role: Role.PROCUREMENT_MANAGER },
  { key: 'cubao',       email: `lorna.bautista@${HISTORY_EMAIL_DOMAIN}`, name: 'Lorna Bautista',  role: Role.BRANCH_MANAGER, manages: 'CUB' },
  { key: 'makati',      email: `jun.mercado@${HISTORY_EMAIL_DOMAIN}`,    name: 'Jun Mercado',     role: Role.BRANCH_MANAGER, manages: 'MKT' },
  { key: 'alabang',     email: `grace.villanueva@${HISTORY_EMAIL_DOMAIN}`, name: 'Grace Villanueva', role: Role.BRANCH_MANAGER, manages: 'ALB' },
]

/**
 * Suppliers. The existing one (seed.ts) supplies meat; history adds produce
 * and dry goods. `pattern` is the behaviour built in for Feature 6 to find —
 * listed in the change note so its report can be checked against it.
 */
export type HistorySupplier = {
  name: string
  existing: boolean
  contactName?: string
  phone?: string
  address?: string
  /** Material codes it supplies. */
  materials: string[]
  /** Promised days from order approval to delivery. */
  leadTimeDays: number
  pattern: 'reliable' | 'short-onions' | 'often-late'
}

export const HISTORY_SUPPLIERS: HistorySupplier[] = [
  {
    name: 'Bantang Meat Supply', existing: true, leadTimeDays: 1, pattern: 'reliable',
    materials: ['RM-PORK-BELLY', 'RM-PORK-BLOOD', 'RM-PORK-HEART', 'RM-PORK-LUNGS', 'RM-PIG-WHOLE', 'RM-LECHON'],
  },
  {
    name: 'Nueva Ecija Fresh Produce', existing: false, contactName: 'Mario Santiago', phone: '0917 555 0142',
    address: 'Cabanatuan City, Nueva Ecija', leadTimeDays: 2, pattern: 'short-onions',
    materials: ['RM-ONION-RED', 'RM-GARLIC', 'RM-GINGER', 'RM-CARROT', 'RM-BELL-RED', 'RM-CHILI-HABA', 'RM-LEMONGRASS'],
  },
  {
    name: 'Divisoria Dry Goods Trading', existing: false, contactName: 'Linda Co', phone: '0918 555 0187',
    address: 'Divisoria, Manila', leadTimeDays: 3, pattern: 'often-late',
    materials: ['RM-VINEGAR', 'RM-OIL', 'RM-SALT', 'RM-SUGAR-BROWN', 'RM-PEPPER', 'RM-BAYLEAF', 'RM-ANNATTO', 'RM-LIVER-SAUCE'],
  },
]

/**
 * Reference prices back-filled for materials whose first price is later than
 * the history window, so runs before then can be costed. Dated before every
 * existing price of the material, so no current price changes.
 */
export const BACKFILL_PRICE_NOTE = 'Back-filled for the history data (Week 10 Task 1)'
export const BACKFILL_PRICE_DATE = '2026-06-01'
export const BACKFILL_PRICES: { code: string; price: string }[] = [
  { code: 'RM-PIG-WHOLE',  price: '245.00' },
  { code: 'RM-LEMONGRASS', price: '75.00' },
]

/** Supplier prices sit a little under the reference price: the reference is what the business budgets with. */
export const SUPPLIER_PRICE_FACTOR = '0.97'
export const SUPPLIER_PRICE_NOTE = 'Supplier rate (history data)'
