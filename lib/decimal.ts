import { Prisma } from '@prisma/client'

/**
 * Prisma `Decimal` values are Decimal.js class instances, not plain JS values.
 * Two consequences, both easy to get wrong:
 *
 * 1. A Decimal cannot be handed to a Client Component. Next.js serialises the
 *    Server → Client boundary and throws "Only plain objects can be passed to
 *    Client Components" on a class instance.
 * 2. `Number(decimal)` silences that error while reintroducing exactly the
 *    floating-point imprecision Decimal exists to prevent — unacceptable for
 *    money and stock quantities (see docs/database.md).
 *
 * So every Decimal leaving the service layer is converted to a string here, in
 * one place, and parsed back into a Decimal when it needs further arithmetic.
 */

export function toDecimalString(value: Prisma.Decimal): string {
  return value.toString()
}

export function toNullableDecimalString(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toString()
}

/** Parse validated input into a Decimal. Callers must zod-check the string first. */
export function toDecimal(value: string | number): Prisma.Decimal {
  return new Prisma.Decimal(value)
}

/**
 * Trims trailing zeros for display without touching the underlying precision —
 * Postgres returns DECIMAL(65,30), so an unformatted 2.5 reads as
 * "2.500000000000000000000000000000".
 */
export function formatQuantity(value: Prisma.Decimal | string): string {
  const decimal = typeof value === 'string' ? new Prisma.Decimal(value) : value
  return decimal.toDecimalPlaces(6).toString()
}

/** Money is always shown at exactly 2 decimal places. */
export function formatMoney(value: Prisma.Decimal | string): string {
  const decimal = typeof value === 'string' ? new Prisma.Decimal(value) : value
  return decimal.toFixed(2)
}
