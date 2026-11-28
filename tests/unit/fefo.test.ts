import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { planFefoTakes, withoutClaims, type LotOnHand } from '@/repositories/finished-good-stock.repository'

/**
 * planFefoTakes decides which finished-good lots a conversion or write-off
 * takes from — the same function for the preview and the approval
 * transaction. It trusts the caller's order (lotsOnHand: soonest expiry
 * first), skips expired lots and never takes more than a lot holds.
 */

const NOW = new Date('2026-11-28T08:00:00Z')
const HOUR = 60 * 60 * 1000

function lot(id: string, quantity: string, expiresAt: Date | null): LotOnHand {
  return {
    quantity: new Prisma.Decimal(quantity),
    lot: { id, lotNumber: `LOT-${id}`, expiresAt, movements: [] },
  }
}

/** The plan as plain values, so a failure prints readably. */
function plan(lots: LotOnHand[], required: string) {
  const result = planFefoTakes(lots, new Prisma.Decimal(required), NOW)
  return {
    takes: result.takes.map(take => [take.lot.id, take.quantity.toString()]),
    short: result.short.toString(),
  }
}

describe('planFefoTakes', () => {
  it('takes the first lot fully, then the rest from the next', () => {
    const lots = [lot('A', '3', new Date(NOW.getTime() + 2 * HOUR)), lot('B', '4', new Date(NOW.getTime() + 20 * HOUR))]
    expect(plan(lots, '5')).toEqual({ takes: [['A', '3'], ['B', '2']], short: '0' })
  })

  it('stops once covered — no zero take from the next lot', () => {
    const lots = [lot('A', '3', null), lot('B', '4', null)]
    expect(plan(lots, '3')).toEqual({ takes: [['A', '3']], short: '0' })
  })

  it('skips a lot that expires exactly now or earlier', () => {
    const lots = [
      lot('expired', '10', new Date(NOW.getTime() - HOUR)),
      lot('expiring-now', '10', NOW),
      lot('fresh', '10', new Date(NOW.getTime() + HOUR)),
    ]
    expect(plan(lots, '4')).toEqual({ takes: [['fresh', '4']], short: '0' })
  })

  it('uses a lot with no expiry (made before expiry was tracked)', () => {
    expect(plan([lot('old', '2', null)], '1.5')).toEqual({ takes: [['old', '1.5']], short: '0' })
  })

  it('reports what the unexpired lots cannot cover', () => {
    const lots = [lot('A', '1', null), lot('expired', '50', new Date(NOW.getTime() - 1)), lot('B', '3', null)]
    expect(plan(lots, '10')).toEqual({ takes: [['A', '1'], ['B', '3']], short: '6' })
  })

  it('takes nothing when nothing is required', () => {
    expect(plan([lot('A', '5', null)], '0')).toEqual({ takes: [], short: '0' })
  })

  it('is short by the whole amount when there are no lots', () => {
    expect(plan([], '2.25')).toEqual({ takes: [], short: '2.25' })
  })

  it('keeps decimal quantities exact (0.1 + 0.2 covers 0.3)', () => {
    const lots = [lot('A', '0.1', null), lot('B', '0.2', null)]
    expect(plan(lots, '0.3')).toEqual({ takes: [['A', '0.1'], ['B', '0.2']], short: '0' })
  })
})

/**
 * withoutClaims: what a conversion or transfer may take once pending
 * write-offs keep their kilos — a lot found spoiled must not be cooked into
 * another good or sent to an outlet while accounting decides.
 */
describe('withoutClaims', () => {
  const claims = (entries: [string, string][]) => new Map(entries.map(([id, q]) => [id, new Prisma.Decimal(q)]))
  const usable = (lots: LotOnHand[], entries: [string, string][]) =>
    withoutClaims(lots, claims(entries)).map(level => [level.lot.id, level.quantity.toString()])

  it('leaves unclaimed lots as they are', () => {
    expect(usable([lot('A', '3', null), lot('B', '4', null)], [])).toEqual([['A', '3'], ['B', '4']])
  })

  it('takes a part claim off the lot', () => {
    expect(usable([lot('A', '3', null), lot('B', '4', null)], [['A', '1.5']])).toEqual([['A', '1.5'], ['B', '4']])
  })

  it('leaves a fully claimed lot out, keeping the others in order', () => {
    expect(usable([lot('A', '3', null), lot('B', '4', null), lot('C', '1', null)], [['A', '3'], ['C', '5']])).toEqual([['B', '4']])
  })

  it('makes the FEFO plan skip the claimed lot', () => {
    const lots = [lot('spoiled', '3', new Date(NOW.getTime() + HOUR)), lot('good', '10', new Date(NOW.getTime() + 40 * HOUR))]
    const result = planFefoTakes(withoutClaims(lots, claims([['spoiled', '3']])), new Prisma.Decimal('5'), NOW)
    expect(result.takes.map(take => [take.lot.id, take.quantity.toString()])).toEqual([['good', '5']])
  })
})
