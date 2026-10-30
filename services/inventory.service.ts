import { toDecimalString } from '@/lib/decimal'
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
}
