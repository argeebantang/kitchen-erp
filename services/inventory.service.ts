import { Prisma } from '@prisma/client'
import { toDecimalString } from '@/lib/decimal'
import { BranchRepository } from '@/repositories/branch.repository'
import { InventoryRepository, LedgerFilters } from '@/repositories/inventory.repository'
import { ReceivingReportRepository } from '@/repositories/receiving-report.repository'

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
const SOURCE_PAGES: Record<string, { roles: string[]; href: (id: string) => string }> = {
  ReceivingReport: {
    roles: ['ADMIN', 'PROCUREMENT_MANAGER', 'ACCOUNTING'],
    href:  id => `/procurement/receiving/${id}`,
  },
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

    const receivingIds = rows
      .filter(row => row.referenceType === 'ReceivingReport')
      .map(row => row.referenceId)
    const numbers = new Map<string, Map<string, string>>([
      ['ReceivingReport', await ReceivingReportRepository.numbersByIds([...new Set(receivingIds)])],
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
