import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { reorderAlerts, stockStatus, type BranchStockDto, type StockStatus, type StockTileDto } from '@/services/inventory.service'
import { scaleBomQuantities } from '@/services/bom.service'
import type { BomWithDetail } from '@/repositories/bom.repository'

const d = (value: string) => new Prisma.Decimal(value)

describe('stockStatus — the stock map colour rule', () => {
  it('is UNTRACKED when no reorder point is set, whatever the quantity', () => {
    expect(stockStatus(d('0'), d('0'))).toBe('UNTRACKED')
    expect(stockStatus(d('100'), d('0'))).toBe('UNTRACKED')
  })

  it('is OUT at zero or below', () => {
    expect(stockStatus(d('0'), d('5'))).toBe('OUT')
    expect(stockStatus(d('-1'), d('5'))).toBe('OUT')
  })

  it('is LOW up to and including the reorder point', () => {
    expect(stockStatus(d('0.001'), d('5'))).toBe('LOW')
    expect(stockStatus(d('5'), d('5'))).toBe('LOW')
  })

  it('is HEALTHY above it', () => {
    expect(stockStatus(d('5.01'), d('5'))).toBe('HEALTHY')
  })
})

function tile(materialId: string, status: StockStatus): StockTileDto {
  return {
    materialId, materialCode: materialId, materialName: materialId, unitAbbreviation: 'kg',
    quantity: '0', reorderPoint: '5', shortfall: null, status, lastMovementAt: null,
  }
}

function branch(branchId: string, tiles: StockTileDto[]): BranchStockDto {
  return {
    branchId, branchName: `Branch ${branchId}`,
    counts: { OUT: 0, LOW: 0, HEALTHY: 0, UNTRACKED: 0 },
    categories: [{ name: 'Meat', tiles }],
  }
}

describe('reorderAlerts', () => {
  const branches = [
    branch('A', [tile('a-low', 'LOW'), tile('a-ok', 'HEALTHY'), tile('a-out', 'OUT')]),
    branch('B', [tile('b-low', 'LOW'), tile('b-out', 'OUT'), tile('b-untracked', 'UNTRACKED')]),
  ]

  it('lists every OUT tile, then every LOW one, keeping map order within each', () => {
    expect(reorderAlerts(branches).map(alert => alert.materialId)).toEqual(['a-out', 'b-out', 'a-low', 'b-low'])
  })

  it('names the branch on each alert', () => {
    expect(reorderAlerts(branches)[1]).toMatchObject({ materialId: 'b-out', branchId: 'B', branchName: 'Branch B' })
  })

  it('is empty when nothing needs ordering', () => {
    expect(reorderAlerts([branch('A', [tile('ok', 'HEALTHY'), tile('u', 'UNTRACKED')])])).toEqual([])
  })
})

describe('scaleBomQuantities', () => {
  // Only the fields the function reads; the full Prisma payload type is large.
  const bom = {
    batchSize: d('10'),
    items: [
      { id: 'pork', quantity: d('2.5') },
      { id: 'salt', quantity: d('0.333') },
    ],
  } as unknown as BomWithDetail

  const scaled = (target: string) =>
    scaleBomQuantities(bom, d(target)).map(line => [line.lineId, line.quantity.toString()])

  it('scales every line by target ÷ batch size', () => {
    expect(scaled('25')).toEqual([['pork', '6.25'], ['salt', '0.8325']])
  })

  it('returns the recipe itself for one batch', () => {
    expect(scaled('10')).toEqual([['pork', '2.5'], ['salt', '0.333']])
  })

  it('scales down without float drift', () => {
    expect(scaled('1')).toEqual([['pork', '0.25'], ['salt', '0.0333']])
  })
})
