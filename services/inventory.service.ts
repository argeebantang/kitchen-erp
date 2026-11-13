import { Prisma } from '@prisma/client'
import { toDecimalString } from '@/lib/decimal'
import { BranchRepository } from '@/repositories/branch.repository'
import { InventoryRepository, LedgerFilters } from '@/repositories/inventory.repository'
import { ReceivingReportRepository } from '@/repositories/receiving-report.repository'
import { ProductionOrderRepository } from '@/repositories/production-order.repository'
import { ConversionOrderRepository } from '@/repositories/conversion-order.repository'
import { WriteOffRepository } from '@/repositories/write-off.repository'
import { expiryFlag, type ExpiryFlag, type ExpiryStatus } from '@/lib/dates'
import { FinishedGoodStockRepository } from '@/repositories/finished-good-stock.repository'

/** The document a movement came from, as the ledger shows it. */
export type SourceDocumentDto = {
  type: string
  id: string
  /** RR-000001 etc.; null if the document no longer resolves. */
  number: string | null
  /** Null when the viewer's role cannot open that document's page. */
  href: string | null
}

export type ReconciliationDto = {
  ledgerTotal: string
  stockLevel: string
  matches: boolean
}

export type LedgerRowDto = {
  id: string
  createdAt: string
  materialId: string
  materialCode: string
  materialName: string
  unitAbbreviation: string
  branchId: string
  branchName: string
  type: string
  /** Signed: positive into stock, negative out of it. */
  quantity: string
  unitCost: string | null
  /** quantity × unitCost, where a cost exists. */
  value: string | null
  /** Stock after this movement. Only when one material at one branch is shown. */
  balance: string | null
  /** Every movement has one — the columns are NOT NULL. */
  source: SourceDocumentDto
  notes: string | null
}

/**
 * How one material stands at one branch, as the stock map colours it:
 * OUT 🔴, LOW 🟡, HEALTHY 🟢, UNTRACKED ⚪ (no reorder point set).
 */
export type StockStatus = 'OUT' | 'LOW' | 'HEALTHY' | 'UNTRACKED'

export type StockTileDto = {
  materialId: string
  materialCode: string
  materialName: string
  unitAbbreviation: string
  quantity: string
  reorderPoint: string
  /** reorderPoint − quantity while OUT or LOW; otherwise null. */
  shortfall: string | null
  status: StockStatus
  lastMovementAt: string | null
}

export type BranchStockDto = {
  branchId: string
  branchName: string
  counts: Record<StockStatus, number>
  categories: { name: string; tiles: StockTileDto[] }[]
}

export type StockMapFilters = {
  branchId?: string
  status?: StockStatus
}

/** A tile that needs ordering, with the branch it is at. */
export type ReorderAlertDto = StockTileDto & { branchId: string; branchName: string }

/**
 * The stock map's colour rule, in one place so the low-stock job (Task 7) and
 * Week 10's usage-based reorder rule can share or replace it.
 *
 * Nothing measures consumption yet, so "stockout risk" can only mean already
 * out. A reorder point of 0 means nobody has set one, so there is no "low" to
 * measure against — UNTRACKED, whatever the quantity.
 */
export function stockStatus(quantity: Prisma.Decimal, reorderPoint: Prisma.Decimal): StockStatus {
  if (reorderPoint.lte(0))        return 'UNTRACKED'
  if (quantity.lte(0))            return 'OUT'
  if (quantity.lte(reorderPoint)) return 'LOW'
  return 'HEALTHY'
}

/**
 * What to order, from the stock map: every OUT tile, then every LOW one,
 * across all branches. The sort is stable, so within a status the map's own
 * order (branch, category, name) holds. Shortfalls are not ranked against each
 * other — they are in different units.
 */
export function reorderAlerts(branches: BranchStockDto[]): ReorderAlertDto[] {
  const alerts = branches.flatMap(branch =>
    branch.categories.flatMap(category =>
      category.tiles
        .filter(tile => tile.status === 'OUT' || tile.status === 'LOW')
        .map(tile => ({ ...tile, branchId: branch.branchId, branchName: branch.branchName })),
    ),
  )
  return alerts.sort((a, b) => Number(b.status === 'OUT') - Number(a.status === 'OUT'))
}

/**
 * Who may open each kind of source document — the roles middleware.ts lets
 * onto its pages. Everyone else sees the number without a link.
 */
export const SOURCE_PAGES: Record<string, { roles: string[]; href: (id: string) => string }> = {
  ReceivingReport: {
    roles: ['ADMIN', 'PROCUREMENT_MANAGER', 'ACCOUNTING'],
    href:  id => `/procurement/receiving/${id}`,
  },
  // Ingredients deducted when a completed run was signed off (Week 6 Task 2).
  ProductionOrder: {
    roles: ['ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTING'],
    href:  id => `/production/orders/${id}`,
  },
  // Added ingredients deducted when a conversion was approved (Week 7 Task 1).
  ConversionOrder: {
    roles: ['ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTING'],
    href:  id => `/production/conversions/${id}`,
  },
  // Finished goods written off (Week 7 Task 2) — on the End of Day page.
  WriteOff: {
    roles: ['ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTING'],
    href:  id => `/inventory/write-offs/${id}`,
  },
}

/** The Finished Goods page's expiry filter (Week 7 Task 3, X2): a query-string value and the status it shows. */
export const EXPIRY_FILTERS: { value: string; status: ExpiryStatus; label: string }[] = [
  { value: 'expired', status: 'EXPIRED',    label: 'expired' },
  { value: '24h',     status: 'WITHIN_24H', label: 'within 24 h' },
  { value: '48h',     status: 'WITHIN_48H', label: 'within 48 h' },
]

/** The most lots the Finished Goods page lists (D10). */
export const FINISHED_GOOD_LOT_LIMIT = 500

/** One lot at one branch, on the Finished Goods page (Week 6 Task 2, D10). */
export type FinishedGoodLotDto = {
  lotId: string
  lotNumber: string
  finishedGoodId: string
  finishedGoodCode: string
  finishedGoodName: string
  unitAbbreviation: string
  branchId: string
  branchName: string
  quantity: string
  /** YYYY-MM-DD. */
  producedOn: string
  /** ISO; null for a lot made before expiry was tracked (Week 6 Task 4). */
  expiresAt: string | null
  /** Past its expiry as of this read — must not be used. */
  expired: boolean
  /** Expired / within 24 h / within 48 h / OK, as of this read (Week 7 Task 3); null with no expiry. */
  expiry: ExpiryFlag | null
  /** When this lot last moved at this branch (ISO). */
  lastMovementAt: string
  /** The lot's cost per unit, recorded when its run was approved; null before costing (Week 6 Task 3). */
  unitCost: string | null
  /** quantity × unitCost: what the lot on hand here is worth. */
  value: string | null
  /** The run that made it — a link for roles that can open production orders. */
  source: { number: string; href: string | null } | null
  /**
   * Claimed by write-offs awaiting approval (Week 7 Task 2, W8): still on
   * hand, but about to leave. Null when there are none. The link is the
   * pending write-offs list, for roles that can open it.
   */
  pendingWriteOff: { quantity: string; href: string | null } | null
}

type FinishedGoodLevelRow = Awaited<ReturnType<typeof FinishedGoodStockRepository.findLevels>>[number]

/** A lot's cost per unit, from the IN movement that created it. */
function unitCostOf(row: FinishedGoodLevelRow): Prisma.Decimal | null {
  return row.lot.movements[0]?.unitCost ?? null
}

/** What the lot on hand at this branch is worth. */
function valueOf(row: FinishedGoodLevelRow): Prisma.Decimal | null {
  const unitCost = unitCostOf(row)
  return unitCost === null ? null : row.quantity.mul(unitCost)
}

/** On hand per finished good and branch, summed over its lots in Decimal. */
export type FinishedGoodTotalDto = {
  finishedGoodId: string
  finishedGoodName: string
  branchName: string
  unitAbbreviation: string
  quantity: string
  lotCount: number
  /** Sum of the lots' values; null if any lot has no cost. */
  value: string | null
}

export const InventoryService = {
  /**
   * The stock ledger, newest first. Readable by every signed-in role, like the
   * Stock Levels page; there is no branch isolation (docs/database.md).
   *
   * Source documents are resolved to their numbers in one query per document
   * type for the whole page, rather than read from the free-text notes.
   *
   * A balance only means something for one material at one branch, so the
   * running balance and the check against InventoryLevel come only when both
   * filters are set; otherwise they are null.
   */
  async ledger(filters: LedgerFilters, viewer: { role: string }) {
    const { rows, total } = await InventoryRepository.findMovements(filters)

    const single = filters.materialId && filters.branchId
      ? { materialId: filters.materialId, branchId: filters.branchId }
      : null
    const [balances, totals] = single
      ? await Promise.all([
          InventoryRepository.runningBalances(single.materialId, single.branchId, rows.map(row => row.id)),
          InventoryRepository.reconcile(single.materialId, single.branchId),
        ])
      : [null, null]

    const idsOf = (type: string) => [...new Set(rows.filter(row => row.referenceType === type).map(row => row.referenceId))]
    const [receivingNumbers, productionNumbers, conversionNumbers] = await Promise.all([
      ReceivingReportRepository.numbersByIds(idsOf('ReceivingReport')),
      ProductionOrderRepository.numbersByIds(idsOf('ProductionOrder')),
      ConversionOrderRepository.numbersByIds(idsOf('ConversionOrder')),
    ])
    const numbers = new Map<string, Map<string, string>>([
      ['ReceivingReport', receivingNumbers],
      ['ProductionOrder', productionNumbers],
      ['ConversionOrder', conversionNumbers],
    ])

    const movements = rows.map<LedgerRowDto>(row => {
      const balance = balances?.get(row.id)
      const page = SOURCE_PAGES[row.referenceType]
      const source: SourceDocumentDto = {
        type:   row.referenceType,
        id:     row.referenceId,
        number: numbers.get(row.referenceType)?.get(row.referenceId) ?? null,
        href:   page && page.roles.includes(viewer.role) ? page.href(row.referenceId) : null,
      }

      return {
        id:               row.id,
        createdAt:        row.createdAt.toISOString(),
        materialId:       row.materialId,
        materialCode:     row.material.code,
        materialName:     row.material.name,
        unitAbbreviation: row.material.unit.abbreviation,
        branchId:         row.branchId,
        branchName:       row.branch.name,
        type:             row.type,
        quantity:         toDecimalString(row.quantity),
        unitCost:         row.unitCost === null ? null : toDecimalString(row.unitCost),
        value:            row.unitCost === null ? null : toDecimalString(row.quantity.mul(row.unitCost)),
        balance:          balance === undefined ? null : toDecimalString(balance),
        source,
        notes:            row.notes,
      }
    })

    const reconciliation: ReconciliationDto | null = totals && {
      ledgerTotal: toDecimalString(totals.ledgerTotal),
      stockLevel:  toDecimalString(totals.stockLevel),
      matches:     totals.ledgerTotal.equals(totals.stockLevel),
    }

    return { movements, total, reconciliation }
  },

  /**
   * Finished goods on hand (Week 6 Task 2, D10): every lot with stock at a
   * branch, soonest expiry first (Week 6 Task 4), and the total per finished
   * good and branch. Readable by every signed-in role, like Stock Levels.
   */
  async finishedGoodStock(filters: { branchId?: string; expiry?: ExpiryStatus }, viewer: { role: string }) {
    const [rows, pendingWriteOffs] = await Promise.all([
      FinishedGoodStockRepository.findLevels({ branchId: filters.branchId, take: FINISHED_GOOD_LOT_LIMIT + 1 }),
      WriteOffRepository.pendingByLot(),
    ])
    const pendingByLot = new Map(pendingWriteOffs.map(row => [`${row.lotId}:${row.branchId}`, row.quantity]))
    const canOpenWriteOffs = ['ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTING'].includes(viewer.role)
    const truncated = rows.length > FINISHED_GOOD_LOT_LIMIT
    const shown     = rows.slice(0, FINISHED_GOOD_LOT_LIMIT)
    const orderPage      = SOURCE_PAGES.ProductionOrder
    const conversionPage = SOURCE_PAGES.ConversionOrder

    // One clock for the whole page, so two lots expiring together read alike.
    const now  = Date.now()
    const lots = shown.map<FinishedGoodLotDto>(row => {
      const unitCost = unitCostOf(row)
      const value    = valueOf(row)
      return {
        lotId:            row.lot.id,
        lotNumber:        row.lot.lotNumber,
        finishedGoodId:   row.lot.finishedGood.id,
        finishedGoodCode: row.lot.finishedGood.code,
        finishedGoodName: row.lot.finishedGood.name,
        unitAbbreviation: row.lot.finishedGood.unit.abbreviation,
        branchId:         row.branch.id,
        branchName:       row.branch.name,
        quantity:         toDecimalString(row.quantity),
        producedOn:       row.lot.producedOn.toISOString().slice(0, 10),
        expiresAt:        row.lot.expiresAt?.toISOString() ?? null,
        expired:          row.lot.expiresAt !== null && row.lot.expiresAt.getTime() <= now,
        expiry:           expiryFlag(row.lot.expiresAt, now),
        lastMovementAt:   row.updatedAt.toISOString(),
        unitCost:         unitCost === null ? null : toDecimalString(unitCost),
        value:            value === null ? null : toDecimalString(value),
        // A lot is numbered after the document that made it: a production
        // order (Week 6 Task 2, D6) or a conversion (Week 7 Task 1, D8).
        source: row.lot.productionOrderId !== null ? {
          number: row.lot.lotNumber,
          href:   orderPage.roles.includes(viewer.role) ? orderPage.href(row.lot.productionOrderId) : null,
        } : row.lot.conversionOrderId !== null ? {
          number: row.lot.lotNumber,
          href:   conversionPage.roles.includes(viewer.role) ? conversionPage.href(row.lot.conversionOrderId) : null,
        } : null,
        pendingWriteOff: (() => {
          const pending = pendingByLot.get(`${row.lot.id}:${row.branch.id}`)
          return pending === undefined ? null : {
            quantity: toDecimalString(pending),
            href:     canOpenWriteOffs ? '/inventory/write-offs?status=PENDING_APPROVAL' : null,
          }
        })(),
      }
    })

    const totals = new Map<string, FinishedGoodTotalDto & { sum: Prisma.Decimal; worth: Prisma.Decimal | null }>()
    for (const [index, lot] of lots.entries()) {
      const key = `${lot.finishedGoodId}:${lot.branchId}`
      const current = totals.get(key) ?? {
        finishedGoodId: lot.finishedGoodId, finishedGoodName: lot.finishedGoodName, branchName: lot.branchName,
        unitAbbreviation: lot.unitAbbreviation, quantity: '0', lotCount: 0, value: null,
        sum: new Prisma.Decimal(0), worth: new Prisma.Decimal(0),
      }
      const lotValue = valueOf(shown[index])
      current.sum   = current.sum.add(shown[index].quantity)
      current.worth = current.worth !== null && lotValue !== null ? current.worth.add(lotValue) : null
      current.lotCount += 1
      totals.set(key, current)
    }

    // Week 7 Task 3, X2: how many lots with stock are flagged — over everything
    // shown, whatever the expiry filter — and the lots the filter keeps. A
    // negative level holds nothing to use, so it is not counted.
    const flagged = lots.filter(lot => !lot.quantity.startsWith('-'))
    const expiryCounts = {
      expired:   flagged.filter(lot => lot.expiry?.status === 'EXPIRED').length,
      within24h: flagged.filter(lot => lot.expiry?.status === 'WITHIN_24H').length,
      within48h: flagged.filter(lot => lot.expiry?.status === 'WITHIN_48H').length,
    }

    return {
      lots: filters.expiry === undefined ? lots : lots.filter(lot => lot.expiry?.status === filters.expiry),
      expiryCounts,
      totals: [...totals.values()]
        .map(({ sum, worth, ...total }) => ({ ...total, quantity: toDecimalString(sum), value: worth === null ? null : toDecimalString(worth) }))
        .sort((a, b) => a.branchName.localeCompare(b.branchName) || a.finishedGoodName.localeCompare(b.finishedGoodName)),
      truncated,
    }
  },

  /**
   * The stock map: every active material at every active branch, grouped by
   * category in the order the repository returns them. A missing level row is
   * zero stock — a material never received must show red, not disappear.
   *
   * Filters narrow the branches and the tiles shown, but a branch's counts
   * always cover all its materials, so they still read as the whole picture.
   * A category left with no tiles is dropped.
   */
  async stockMap(filters: StockMapFilters = {}): Promise<BranchStockDto[]> {
    const [branches, { materials, levels }] = await Promise.all([
      BranchRepository.findAllActive(),
      InventoryRepository.stockPositions(),
    ])

    const key = (materialId: string, branchId: string) => `${materialId}:${branchId}`
    const levelsByKey = new Map(levels.map(level => [key(level.materialId, level.branchId), level]))
    const zero = new Prisma.Decimal(0)

    const shown = filters.branchId ? branches.filter(branch => branch.id === filters.branchId) : branches

    return shown.map<BranchStockDto>(branch => {
      const counts: Record<StockStatus, number> = { OUT: 0, LOW: 0, HEALTHY: 0, UNTRACKED: 0 }
      const categories: BranchStockDto['categories'] = []

      for (const material of materials) {
        const level = levelsByKey.get(key(material.id, branch.id))
        const quantity = level?.quantity ?? zero
        const status = stockStatus(quantity, material.reorderPoint)
        counts[status] += 1
        if (filters.status && status !== filters.status) continue

        const tile: StockTileDto = {
          materialId:       material.id,
          materialCode:     material.code,
          materialName:     material.name,
          unitAbbreviation: material.unit.abbreviation,
          quantity:         toDecimalString(quantity),
          reorderPoint:     toDecimalString(material.reorderPoint),
          shortfall:        status === 'OUT' || status === 'LOW'
            ? toDecimalString(material.reorderPoint.minus(quantity))
            : null,
          status,
          lastMovementAt:   level?.updatedAt.toISOString() ?? null,
        }

        // Materials arrive sorted by category, so a new name starts a new group.
        const current = categories.at(-1)
        if (current?.name === material.category.name) current.tiles.push(tile)
        else categories.push({ name: material.category.name, tiles: [tile] })
      }

      return { branchId: branch.id, branchName: branch.name, counts, categories }
    })
  },
}
