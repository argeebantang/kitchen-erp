import { prisma } from '@/lib/prisma'
import { BACKFILL_PRICE_NOTE, HISTORY_BRANCHES, HISTORY_EMAIL_DOMAIN, HISTORY_SUPPLIERS, SUPPLIER_PRICE_NOTE } from './cast'

/**
 * --clean (Week 10 Task 1): removes exactly what the history added.
 *
 * Everything is found from the history staff (HISTORY_EMAIL_DOMAIN): the
 * documents they made, those documents' children, ledger rows and approvals
 * by reference, the lots their runs and conversions made. Stock levels the
 * history touched at your own branches are recomputed from what remains of
 * the ledger, so the Stock Ledger page stays ✓. Each number sequence is reset
 * to the highest number left.
 *
 * Refuses, deleting nothing, if any of your own rows depend on the history —
 * e.g. a transfer of a history lot, or a document at a history branch.
 *
 * Raw SQL on temp tables: the id lists run to thousands, past what a Prisma
 * `in` list can bind, and the whole removal is one transaction. Every
 * statement is a constant; the only values are the constants in cast.ts.
 */

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`
const list  = (values: string[]) => values.map(quote).join(', ')

const HISTORY_BRANCH_CODES   = list(HISTORY_BRANCHES.map(b => b.code))
const HISTORY_SUPPLIER_NAMES = list(HISTORY_SUPPLIERS.filter(s => !s.existing).map(s => s.name))

/** The document sets, each a temp table of ids, dropped at commit. */
const COLLECT = [
  `CREATE TEMP TABLE h_users ON COMMIT DROP AS SELECT id FROM "User" WHERE email LIKE ${quote(`%@${HISTORY_EMAIL_DOMAIN}`)}`,
  `CREATE TEMP TABLE h_branches ON COMMIT DROP AS SELECT id FROM "Branch" WHERE code IN (${HISTORY_BRANCH_CODES})`,
  `CREATE TEMP TABLE h_suppliers ON COMMIT DROP AS SELECT id FROM "Supplier" WHERE name IN (${HISTORY_SUPPLIER_NAMES})`,
  `CREATE TEMP TABLE h_pr ON COMMIT DROP AS SELECT id FROM "PurchaseRequest" WHERE "requestedById" IN (SELECT id FROM h_users)`,
  `CREATE TEMP TABLE h_po ON COMMIT DROP AS SELECT id FROM "PurchaseOrder"
     WHERE "purchaseRequestId" IN (SELECT id FROM h_pr) OR "submittedById" IN (SELECT id FROM h_users)`,
  `CREATE TEMP TABLE h_rr ON COMMIT DROP AS SELECT id FROM "ReceivingReport"
     WHERE "receivedById" IN (SELECT id FROM h_users) OR "purchaseOrderId" IN (SELECT id FROM h_po)`,
  `CREATE TEMP TABLE h_prd ON COMMIT DROP AS SELECT id FROM "ProductionOrder" WHERE "requestedById" IN (SELECT id FROM h_users)`,
  `CREATE TEMP TABLE h_cnv ON COMMIT DROP AS SELECT id FROM "ConversionOrder" WHERE "submittedById" IN (SELECT id FROM h_users)`,
  `CREATE TEMP TABLE h_wo ON COMMIT DROP AS SELECT id FROM "WriteOff" WHERE "submittedById" IN (SELECT id FROM h_users)`,
  `CREATE TEMP TABLE h_str ON COMMIT DROP AS SELECT id FROM "StockRequest" WHERE "submittedById" IN (SELECT id FROM h_users)`,
  `CREATE TEMP TABLE h_sls ON COMMIT DROP AS SELECT id FROM "OutletSale" WHERE "submittedById" IN (SELECT id FROM h_users)`,
  `CREATE TEMP TABLE h_trf ON COMMIT DROP AS SELECT id FROM "StockTransfer"
     WHERE "submittedById" IN (SELECT id FROM h_users) OR "stockRequestId" IN (SELECT id FROM h_str)`,
  `CREATE TEMP TABLE h_lots ON COMMIT DROP AS SELECT id FROM "FinishedGoodLot"
     WHERE "productionOrderId" IN (SELECT id FROM h_prd) OR "conversionOrderId" IN (SELECT id FROM h_cnv)`,
  `CREATE TEMP TABLE h_docs ON COMMIT DROP AS
     SELECT id FROM h_pr UNION SELECT id FROM h_po UNION SELECT id FROM h_rr UNION SELECT id FROM h_prd
     UNION SELECT id FROM h_cnv UNION SELECT id FROM h_wo UNION SELECT id FROM h_str UNION SELECT id FROM h_trf
     UNION SELECT id FROM h_sls`,
]

/** Your rows that depend on the history. Any count above zero stops the clean. */
const CONFLICTS: { label: string; sql: string }[] = [
  { label: 'finished-goods movements of history lots made by your documents',
    sql: `SELECT count(*) FROM "FinishedGoodMovement" WHERE "lotId" IN (SELECT id FROM h_lots) AND "referenceId" NOT IN (SELECT id FROM h_docs)` },
  { label: 'your write-offs of history lots',
    sql: `SELECT count(*) FROM "WriteOff" WHERE "lotId" IN (SELECT id FROM h_lots) AND id NOT IN (SELECT id FROM h_wo)` },
  { label: 'your production orders at history branches',
    sql: `SELECT count(*) FROM "ProductionOrder" WHERE "branchId" IN (SELECT id FROM h_branches) AND id NOT IN (SELECT id FROM h_prd)` },
  { label: 'your receiving reports at history branches',
    sql: `SELECT count(*) FROM "ReceivingReport" WHERE "branchId" IN (SELECT id FROM h_branches) AND id NOT IN (SELECT id FROM h_rr)` },
  { label: 'your conversions at history branches',
    sql: `SELECT count(*) FROM "ConversionOrder" WHERE "branchId" IN (SELECT id FROM h_branches) AND id NOT IN (SELECT id FROM h_cnv)` },
  { label: 'your write-offs at history branches',
    sql: `SELECT count(*) FROM "WriteOff" WHERE "branchId" IN (SELECT id FROM h_branches) AND id NOT IN (SELECT id FROM h_wo)` },
  { label: 'your transfers to or from history branches',
    sql: `SELECT count(*) FROM "StockTransfer" WHERE ("fromBranchId" IN (SELECT id FROM h_branches) OR "toBranchId" IN (SELECT id FROM h_branches)) AND id NOT IN (SELECT id FROM h_trf)` },
  { label: 'your stock requests to or from history branches',
    sql: `SELECT count(*) FROM "StockRequest" WHERE ("branchId" IN (SELECT id FROM h_branches) OR "kitchenId" IN (SELECT id FROM h_branches)) AND id NOT IN (SELECT id FROM h_str)` },
  { label: 'your daily sales at history outlets',
    sql: `SELECT count(*) FROM "OutletSale" WHERE "branchId" IN (SELECT id FROM h_branches) AND id NOT IN (SELECT id FROM h_sls)` },
  { label: 'your users assigned to history branches',
    sql: `SELECT count(*) FROM "User" WHERE "branchId" IN (SELECT id FROM h_branches) AND id NOT IN (SELECT id FROM h_users)` },
  { label: 'your purchase orders with history suppliers',
    sql: `SELECT count(*) FROM "PurchaseOrder" WHERE "supplierId" IN (SELECT id FROM h_suppliers) AND id NOT IN (SELECT id FROM h_po)` },
  { label: 'your prices at history suppliers',
    sql: `SELECT count(*) FROM "ItemPrice" WHERE "supplierId" IN (SELECT id FROM h_suppliers) AND note IS DISTINCT FROM ${quote(SUPPLIER_PRICE_NOTE)}` },
  { label: 'approvals by history staff on your documents',
    sql: `SELECT count(*) FROM "Approval" WHERE "approverId" IN (SELECT id FROM h_users) AND "referenceId" NOT IN (SELECT id FROM h_docs)` },
  { label: 'status changes by history staff on your production orders',
    sql: `SELECT count(*) FROM "ProductionStatusChange" WHERE "changedById" IN (SELECT id FROM h_users) AND "productionOrderId" NOT IN (SELECT id FROM h_prd)` },
  { label: 'your documents completed, received or decided by history staff',
    sql: `SELECT (SELECT count(*) FROM "ProductionOrder" WHERE ("submittedById" IN (SELECT id FROM h_users) OR "completedById" IN (SELECT id FROM h_users)) AND id NOT IN (SELECT id FROM h_prd))
           + (SELECT count(*) FROM "StockTransfer" WHERE "receivedById" IN (SELECT id FROM h_users) AND id NOT IN (SELECT id FROM h_trf))
           + (SELECT count(*) FROM "StockRequest" WHERE "decidedById" IN (SELECT id FROM h_users) AND id NOT IN (SELECT id FROM h_str))
           + (SELECT count(*) FROM "PurchaseOrder" WHERE "submittedById" IN (SELECT id FROM h_users) AND id NOT IN (SELECT id FROM h_po))
           + (SELECT count(*) FROM "AiQuery" WHERE "userId" IN (SELECT id FROM h_users))` },
]

/** In dependency order: children before parents, ledger before documents. */
const DELETE: { label: string; sql: string }[] = [
  { label: 'notifications', sql: `DELETE FROM "Notification" WHERE "userId" IN (SELECT id FROM h_users) OR "referenceId" IN (SELECT id FROM h_docs)` },
  { label: 'AI insights',   sql: `DELETE FROM "AiInsight" WHERE "referenceId" IN (SELECT id FROM h_docs)` },
  { label: 'approvals',     sql: `DELETE FROM "Approval" WHERE "referenceId" IN (SELECT id FROM h_docs)` },
  { label: 'finished-goods movements', sql: `DELETE FROM "FinishedGoodMovement" WHERE "lotId" IN (SELECT id FROM h_lots) OR "referenceId" IN (SELECT id FROM h_docs)` },
  { label: 'finished-goods levels',    sql: `DELETE FROM "FinishedGoodLevel" WHERE "lotId" IN (SELECT id FROM h_lots) OR "branchId" IN (SELECT id FROM h_branches)` },
  { label: 'write-offs',    sql: `DELETE FROM "WriteOff" WHERE id IN (SELECT id FROM h_wo)` },
  { label: 'stock movements', sql: `DELETE FROM "StockMovement" WHERE "referenceId" IN (SELECT id FROM h_docs)` },
  { label: 'lots',          sql: `DELETE FROM "FinishedGoodLot" WHERE id IN (SELECT id FROM h_lots)` },
  { label: 'production status changes', sql: `DELETE FROM "ProductionStatusChange" WHERE "productionOrderId" IN (SELECT id FROM h_prd)` },
  { label: 'production orders', sql: `DELETE FROM "ProductionOrder" WHERE id IN (SELECT id FROM h_prd)` },
  { label: 'conversions',   sql: `DELETE FROM "ConversionOrder" WHERE id IN (SELECT id FROM h_cnv)` },
  { label: 'transfers',     sql: `DELETE FROM "StockTransfer" WHERE id IN (SELECT id FROM h_trf)` },
  { label: 'stock requests', sql: `DELETE FROM "StockRequest" WHERE id IN (SELECT id FROM h_str)` },
  { label: 'daily sales',   sql: `DELETE FROM "OutletSale" WHERE id IN (SELECT id FROM h_sls)` },
  { label: 'receiving lines', sql: `DELETE FROM "ReceivingReportItem" WHERE "receivingReportId" IN (SELECT id FROM h_rr)` },
  { label: 'receiving reports', sql: `DELETE FROM "ReceivingReport" WHERE id IN (SELECT id FROM h_rr)` },
  { label: 'purchase order lines', sql: `DELETE FROM "PurchaseOrderItem" WHERE "purchaseOrderId" IN (SELECT id FROM h_po)` },
  { label: 'purchase orders', sql: `DELETE FROM "PurchaseOrder" WHERE id IN (SELECT id FROM h_po)` },
  { label: 'purchase request lines', sql: `DELETE FROM "PurchaseRequestItem" WHERE "purchaseRequestId" IN (SELECT id FROM h_pr)` },
  { label: 'purchase requests', sql: `DELETE FROM "PurchaseRequest" WHERE id IN (SELECT id FROM h_pr)` },
  { label: 'prices',        sql: `DELETE FROM "ItemPrice" WHERE note IN (${list([BACKFILL_PRICE_NOTE, SUPPLIER_PRICE_NOTE])})` },
  { label: 'stock levels at history branches', sql: `DELETE FROM "InventoryLevel" WHERE "branchId" IN (SELECT id FROM h_branches)` },
  { label: 'outlet managers unassigned', sql: `UPDATE "Branch" SET "managerId" = NULL WHERE id IN (SELECT id FROM h_branches) AND "managerId" IS NOT NULL` },
  { label: 'staff',         sql: `DELETE FROM "User" WHERE id IN (SELECT id FROM h_users)` },
  { label: 'branches',      sql: `DELETE FROM "Branch" WHERE id IN (SELECT id FROM h_branches)` },
  { label: 'suppliers',     sql: `DELETE FROM "Supplier" WHERE id IN (SELECT id FROM h_suppliers)` },
]

/** Document numbers: sequence, table, column, prefix. */
const SEQUENCES: [string, string, string, string][] = [
  ['pr_number_seq',  'PurchaseRequest', 'prNumber',       'PR-'],
  ['po_number_seq',  'PurchaseOrder',   'poNumber',       'PO-'],
  ['rr_number_seq',  'ReceivingReport', 'rrNumber',       'RR-'],
  ['prd_number_seq', 'ProductionOrder', 'orderNumber',    'PRD-'],
  ['cnv_number_seq', 'ConversionOrder', 'orderNumber',    'CNV-'],
  ['wo_number_seq',  'WriteOff',        'writeOffNumber', 'WO-'],
  ['trf_number_seq', 'StockTransfer',   'transferNumber', 'TRF-'],
  ['rtn_number_seq', 'StockTransfer',   'transferNumber', 'RTN-'],
  ['str_number_seq', 'StockRequest',    'requestNumber',  'STR-'],
  ['sls_number_seq', 'OutletSale',      'saleNumber',     'SLS-'],
]

export type CleanResult =
  | { removed: true; counts: { label: string; rows: number }[]; levelsRecomputed: number }
  | { removed: false; reason: string }

export async function cleanHistory(): Promise<CleanResult> {
  return prisma.$transaction(async tx => {
    for (const sql of COLLECT) await tx.$executeRawUnsafe(sql)

    // Branches and suppliers count too, so a run that stopped half-way is still cleaned up.
    const [{ count: found }] = await tx.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT (SELECT count(*) FROM h_users) + (SELECT count(*) FROM h_branches) + (SELECT count(*) FROM h_suppliers)
            + (SELECT count(*) FROM "ItemPrice" WHERE note IN (${list([BACKFILL_PRICE_NOTE, SUPPLIER_PRICE_NOTE])})) AS count`,
    )
    if (found === BigInt(0)) return { removed: false as const, reason: 'There is no history data.' }

    const conflicts: string[] = []
    for (const check of CONFLICTS) {
      const [{ count }] = await tx.$queryRawUnsafe<{ count: bigint }[]>(check.sql)
      if (count > BigInt(0)) conflicts.push(`${count} ${check.label}`)
    }
    if (conflicts.length > 0) {
      return {
        removed: false as const,
        reason:  `Nothing was removed — your own data depends on the history:\n  - ${conflicts.join('\n  - ')}\nRemove those first.`,
      }
    }

    // The stock levels at your own branches that history rows moved: recomputed
    // from what is left of the ledger once those rows are gone.
    await tx.$executeRawUnsafe(`CREATE TEMP TABLE h_touched ON COMMIT DROP AS
      SELECT DISTINCT "materialId", "branchId" FROM "StockMovement"
      WHERE "referenceId" IN (SELECT id FROM h_docs) AND "branchId" NOT IN (SELECT id FROM h_branches)`)

    const counts: { label: string; rows: number }[] = []
    for (const step of DELETE) {
      const rows = await tx.$executeRawUnsafe(step.sql)
      if (rows > 0) counts.push({ label: step.label, rows })
    }

    const levelsRecomputed = await tx.$executeRawUnsafe(`
      UPDATE "InventoryLevel" l
         SET quantity = COALESCE((SELECT sum(m.quantity) FROM "StockMovement" m
                                   WHERE m."materialId" = l."materialId" AND m."branchId" = l."branchId"), 0),
             "updatedAt" = now()
        FROM h_touched t
       WHERE l."materialId" = t."materialId" AND l."branchId" = t."branchId"`)
    // A level the history created and nothing else has moved: gone, as if never stocked.
    await tx.$executeRawUnsafe(`
      DELETE FROM "InventoryLevel" l USING h_touched t
       WHERE l."materialId" = t."materialId" AND l."branchId" = t."branchId"
         AND NOT EXISTS (SELECT 1 FROM "StockMovement" m WHERE m."materialId" = l."materialId" AND m."branchId" = l."branchId")`)

    for (const [sequence, table, column, prefix] of SEQUENCES) {
      const [{ max }] = await tx.$queryRawUnsafe<{ max: number | null }[]>(
        `SELECT max(substring("${column}" FROM ${prefix.length + 1})::int) AS max FROM "${table}" WHERE "${column}" LIKE ${quote(`${prefix}%`)}`,
      )
      // setval(n, true): the next number is n + 1; (1, false): the next is 1.
      if (max === null) await tx.$executeRawUnsafe(`SELECT setval('${sequence}', 1, false)`)
      else await tx.$executeRawUnsafe(`SELECT setval('${sequence}', ${Number(max)}, true)`)
    }

    return { removed: true as const, counts, levelsRecomputed }
  }, { timeout: 120_000, maxWait: 10_000 })
}
