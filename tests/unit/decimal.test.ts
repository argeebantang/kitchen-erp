import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { formatMoney, formatQuantity, toDecimal, toDecimalString, toNullableDecimalString } from '@/lib/decimal'
import { isTransferVarianceReason, transferVarianceReasonLabel } from '@/lib/transfer-variance'

describe('decimal helpers', () => {
  it('keeps arithmetic exact where JS numbers drift', () => {
    expect(0.1 + 0.2).not.toBe(0.3)
    expect(toDecimal('0.1').plus(toDecimal('0.2')).toString()).toBe('0.3')
  })

  it('converts to strings for the Server → Client boundary', () => {
    expect(toDecimalString(new Prisma.Decimal('12.5'))).toBe('12.5')
    expect(toNullableDecimalString(null)).toBeNull()
    expect(toNullableDecimalString(new Prisma.Decimal('0'))).toBe('0')
  })

  it('trims the zeros Postgres DECIMAL(65,30) returns', () => {
    expect(formatQuantity('2.500000000000000000000000000000')).toBe('2.5')
    expect(formatQuantity(new Prisma.Decimal('3'))).toBe('3')
  })

  it('shows quantities to at most 6 places, rounded', () => {
    expect(formatQuantity('1.23456789')).toBe('1.234568')
  })

  it('shows money at exactly 2 places, rounding half up', () => {
    expect(formatMoney('3')).toBe('3.00')
    expect(formatMoney('2.005')).toBe('2.01')
    expect(formatMoney(new Prisma.Decimal('1234.5'))).toBe('1234.50')
  })
})

describe('transfer variance reasons', () => {
  it('accepts only the enum values, case-sensitive', () => {
    expect(isTransferVarianceReason('DAMAGED')).toBe(true)
    expect(isTransferVarianceReason('OTHER')).toBe(true)
    expect(isTransferVarianceReason('damaged')).toBe(false)
    expect(isTransferVarianceReason('')).toBe(false)
  })

  it('labels a reason, and falls back to the raw value', () => {
    expect(transferVarianceReasonLabel('SPOILED')).toBe('Spoiled')
    expect(transferVarianceReasonLabel('UNKNOWN')).toBe('UNKNOWN')
  })
})
