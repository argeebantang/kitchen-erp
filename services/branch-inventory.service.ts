import { BranchType, Prisma } from '@prisma/client'
import { toDecimal, toDecimalString } from '@/lib/decimal'
import { BranchRepository, type BranchWithManager } from '@/repositories/branch.repository'
import { StockTransferRepository } from '@/repositories/stock-transfer.repository'
import { InventoryService, SOURCE_PAGES, type BranchStockDto, type FinishedGoodLotDto } from '@/services/inventory.service'
import { StockTransferService, type BranchTransfersDto } from '@/services/stock-transfer.service'

/**
 * Branch Inventory (Week 8 Task 5): one page per branch with everything it
 * holds — finished goods by lot, raw materials, what is on its way — built
 * from the same reads as Finished Goods, Stock Levels and Transfers, so the
 * figures always agree with those pages.
 *
 * Every role sees every branch, as on Stock Levels, except a BRANCH_MANAGER:
 * only the branch they manage, read from Branch.managerId — never the login
 * token (I4).
 */

export type BranchInventoryViewer = { userId: string; role: string }

export const BRANCH_TYPE_LABELS: Record<BranchType, string> = {
  COMMISSARY: 'Commissary',
  OUTLET:     'Outlet',
}

/** The figures at the top of a branch's page, and on its card. */
export type BranchHeadlineDto = {
  finishedGoods: {
    goods: number
    lots: number
    /** At each lot's cost; null when a lot has no cost. */
    value: string | null
  }
  /** Lots with stock past their expiry — write off or convert. */
  expiredLots: number
  /** Lots with stock expiring within 48 h — use these first. */
  expiringLots: number
  materials: { out: number; low: number; total: number }
  /** Transfers in transit to this branch. */
  arriving: number
}

export type BranchSummaryDto = {
  id: string
  code: string
  name: string
  type: BranchType
  typeLabel: string
  managerName: string | null
}

/** One finished good at the branch: its total, and its lots soonest expiry first. */
export type BranchGoodDto = {
  finishedGoodId: string
  finishedGoodCode: string
  finishedGoodName: string
  unitAbbreviation: string
  quantity: string
  value: string | null
  lots: FinishedGoodLotDto[]
}

export type BranchInventoryDto = {
  branch: BranchSummaryDto
  headline: BranchHeadlineDto
  goods: BranchGoodDto[]
  /** More lots than Finished Goods lists at once; the figures cover the lots shown. */
  truncated: boolean
  /** This branch's raw materials, as on Stock Levels. */
  materials: BranchStockDto | null
  /**
   * In transit to it and awaiting approval; `canOpen` — the viewer may open a
   * transfer (SOURCE_PAGES); `canReturn` — it is an outlet and the viewer runs
   * it, or is an ADMIN, so may send unsold goods back to a kitchen (Week 9 Task 9).
   */
  transfers: BranchTransfersDto & { canOpen: boolean; canReturn: boolean }
}

/**
 * Which branches the viewer may open (I4). 'none': a branch manager who
 * manages no active branch — they get a notice, like on Transfers.
 */
type Scope = { kind: 'all' } | { kind: 'own'; branchId: string; code: string } | { kind: 'none' }

async function scopeOf(viewer: BranchInventoryViewer): Promise<Scope> {
  if (viewer.role !== 'BRANCH_MANAGER') return { kind: 'all' }
  const managed = await BranchRepository.findManagedBy(viewer.userId)
  return managed && managed.isActive ? { kind: 'own', branchId: managed.id, code: managed.code } : { kind: 'none' }
}

function summaryOf(branch: BranchWithManager): BranchSummaryDto {
  return {
    id:          branch.id,
    code:        branch.code,
    name:        branch.name,
    type:        branch.type,
    typeLabel:   BRANCH_TYPE_LABELS[branch.type],
    managerName: branch.manager?.name ?? null,
  }
}

/**
 * Finished-goods figures from a branch's lots. A negative level (a
 * discrepancy) holds nothing to use, so it is left out of the counts and the
 * value, as Finished Goods leaves it out of its expiry chips; it still shows
 * in the lot list.
 */
function finishedGoodsHeadline(lots: FinishedGoodLotDto[]): Pick<BranchHeadlineDto, 'finishedGoods' | 'expiredLots' | 'expiringLots'> {
  const usable = lots.filter(lot => toDecimal(lot.quantity).greaterThan(0))
  let value: Prisma.Decimal | null = new Prisma.Decimal(0)
  for (const lot of usable) value = value === null || lot.value === null ? null : value.add(toDecimal(lot.value))
  return {
    finishedGoods: {
      goods: new Set(usable.map(lot => lot.finishedGoodId)).size,
      lots:  usable.length,
      value: value === null ? null : toDecimalString(value),
    },
    expiredLots:  usable.filter(lot => lot.expiry?.status === 'EXPIRED').length,
    expiringLots: usable.filter(lot => lot.expiry?.status === 'WITHIN_24H' || lot.expiry?.status === 'WITHIN_48H').length,
  }
}

function materialsHeadline(stock: BranchStockDto | undefined): BranchHeadlineDto['materials'] {
  if (!stock) return { out: 0, low: 0, total: 0 }
  const total = Object.values(stock.counts).reduce((sum, count) => sum + count, 0)
  return { out: stock.counts.OUT, low: stock.counts.LOW, total }
}

/** Lots grouped by good — goods by name, each good's lots kept soonest expiry first, as read. */
function groupByGood(lots: FinishedGoodLotDto[]): BranchGoodDto[] {
  const groups = new Map<string, BranchGoodDto & { sum: Prisma.Decimal; worth: Prisma.Decimal | null }>()
  for (const lot of lots) {
    const group = groups.get(lot.finishedGoodId) ?? {
      finishedGoodId:   lot.finishedGoodId,
      finishedGoodCode: lot.finishedGoodCode,
      finishedGoodName: lot.finishedGoodName,
      unitAbbreviation: lot.unitAbbreviation,
      quantity: '0', value: null, lots: [],
      sum: new Prisma.Decimal(0), worth: new Prisma.Decimal(0),
    }
    group.sum   = group.sum.add(toDecimal(lot.quantity))
    group.worth = group.worth === null || lot.value === null ? null : group.worth.add(toDecimal(lot.value))
    group.lots.push(lot)
    groups.set(lot.finishedGoodId, group)
  }
  return [...groups.values()]
    .map(({ sum, worth, ...group }) => ({ ...group, quantity: toDecimalString(sum), value: worth === null ? null : toDecimalString(worth) }))
    .sort((a, b) => a.finishedGoodName.localeCompare(b.finishedGoodName))
}

export const BranchInventoryService = {
  /**
   * The index: a card per active branch for those who see them all; for a
   * branch manager, which branch to send them to — or none.
   */
  async overview(viewer: BranchInventoryViewer): Promise<
    | { kind: 'all'; cards: { branch: BranchSummaryDto; headline: BranchHeadlineDto }[]; truncated: boolean }
    | { kind: 'own'; code: string }
    | { kind: 'none' }
  > {
    const scope = await scopeOf(viewer)
    if (scope.kind !== 'all') return scope

    const [branches, finished, stock, arriving] = await Promise.all([
      BranchRepository.findAll(false),
      InventoryService.finishedGoodStock({}, viewer),
      InventoryService.stockMap(),
      StockTransferRepository.inTransitCountByBranch(),
    ])
    const cards = branches.map(branch => ({
      branch:   summaryOf(branch),
      headline: {
        ...finishedGoodsHeadline(finished.lots.filter(lot => lot.branchId === branch.id)),
        materials: materialsHeadline(stock.find(entry => entry.branchId === branch.id)),
        arriving:  arriving.get(branch.id) ?? 0,
      },
    }))
    return { kind: 'all', cards, truncated: finished.truncated }
  },

  /**
   * Whether the viewer may hold a live-update stream for this branch, or for
   * every branch (null — the index). The same rule as the pages, so the stream
   * reveals nothing the page would not (I4).
   */
  async mayWatch(branchId: string | null, viewer: BranchInventoryViewer): Promise<boolean> {
    const scope = await scopeOf(viewer)
    if (branchId === null) return scope.kind === 'all'
    if (scope.kind === 'none' || (scope.kind === 'own' && scope.branchId !== branchId)) return false
    const branch = await BranchRepository.findById(branchId)
    return Boolean(branch?.isActive)
  },

  /**
   * One branch by code (case-insensitive in the URL). Null when it does not
   * exist, is inactive, or the viewer may not see it — the page shows "not
   * found" for all three, so a code reveals nothing (I4, I8).
   */
  async forBranch(code: string, viewer: BranchInventoryViewer): Promise<BranchInventoryDto | null> {
    const branch = await BranchRepository.findByCode(code.toUpperCase())
    if (!branch || !branch.isActive) return null
    const scope = await scopeOf(viewer)
    if (scope.kind === 'none' || (scope.kind === 'own' && scope.branchId !== branch.id)) return null

    const [finished, stock, transfers] = await Promise.all([
      InventoryService.finishedGoodStock({ branchId: branch.id }, viewer),
      InventoryService.stockMap({ branchId: branch.id }),
      StockTransferService.openForBranch(branch.id, viewer),
    ])
    const materials = stock.find(entry => entry.branchId === branch.id) ?? null

    return {
      branch:   summaryOf(branch),
      headline: {
        ...finishedGoodsHeadline(finished.lots),
        materials: materialsHeadline(materials ?? undefined),
        // The list itself, so the tile and the list below always agree.
        arriving:  transfers.arriving.length,
      },
      goods:     groupByGood(finished.lots),
      truncated: finished.truncated,
      materials,
      transfers: {
        ...transfers,
        canOpen:   SOURCE_PAGES.StockTransfer.roles.includes(viewer.role),
        canReturn: branch.type === BranchType.OUTLET
          && (viewer.role === 'ADMIN' || (viewer.role === 'BRANCH_MANAGER' && branch.managerId === viewer.userId)),
      },
    }
  },
}
