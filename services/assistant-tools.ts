import type Anthropic from '@anthropic-ai/sdk'
import { Prisma, Role } from '@prisma/client'
import { z } from 'zod'
import { addDays, addMonths, shortDateLabel, todayIsoDate, weekStartOf } from '@/lib/dates'
import { AiReaderRepository } from '@/repositories/ai-reader.repository'
import { ACTION_ROLES, AssistantActionService, DRAFT_MAX_LINES } from '@/services/assistant-action.service'
import { CostingService } from '@/services/costing.service'
import { MAX_BATCH_COUNT } from '@/services/production-order.service'

/**
 * The assistant's tools (Week 9 Task 3, F2 / F3): what Claude may ask the
 * server to look up. Each tool has the schema Claude sees, a zod check of
 * what Claude sends (model output is untrusted input, like a request body),
 * the roles it is offered to, and a run() that calls a service or
 * repository — tools never touch Prisma themselves.
 */

export type AssistantToolViewer = { userId: string; role: string }

/** What a tool runs with: who is asking, and the question being answered (null if it could not be logged) — a draft is stored on it. */
export type AssistantToolContext = AssistantToolViewer & { queryId: string | null }

/** The SQL behind an answer, for "How I got this" (F3). */
export type ToolQuery = { sql: string; rowCount: number; truncated: boolean }

/** What a tool hands back: data for Claude plus a label for "Looked up: …", or an error Claude can correct. */
export type ToolOutcome =
  | { ok: true; label: string; data: unknown; query: ToolQuery | null }
  | { ok: false; error: string }

export type AssistantTool = {
  definition: Anthropic.Beta.BetaTool
  roles: readonly Role[]
  /** 'draft' tools prepare a document for the user to confirm (Week 9 Task 5); they are not shown under "Looked up". */
  kind: 'lookup' | 'draft'
  /** False when the server is not set up for it; the tool is then not offered. */
  available(): boolean
  run(input: unknown, context: AssistantToolContext): Promise<ToolOutcome>
}

type ToolSpec<T> = {
  name: string
  description: string
  /** JSON Schema for Claude, strict: every property listed, additionalProperties false. Keep it in step with `input`. */
  inputSchema: Anthropic.Beta.BetaTool.InputSchema
  input: z.ZodType<T>
  roles: readonly Role[]
  kind?: 'lookup' | 'draft'
  available?: () => boolean
  run(input: T, context: AssistantToolContext): Promise<ToolOutcome>
}

function defineTool<T>(spec: ToolSpec<T>): AssistantTool {
  return {
    definition: { name: spec.name, description: spec.description, input_schema: spec.inputSchema, strict: true },
    roles: spec.roles,
    kind: spec.kind ?? 'lookup',
    available: spec.available ?? (() => true),
    async run(input, context) {
      const parsed = spec.input.safeParse(input)
      if (!parsed.success) {
        const issues = parsed.error.issues.map(issue => `${issue.path.join('.') || 'input'}: ${issue.message}`)
        return { ok: false, error: `Invalid input. ${issues.join('; ')}` }
      }
      return spec.run(parsed.data, context)
    },
  }
}

// ─── get_production_costs ────────────────────────────────────────────────────

export const COST_PERIODS = ['today', 'this_week', 'last_week', 'this_month', 'last_month', 'custom'] as const
/** The longest custom period, in days. */
export const MAX_PERIOD_DAYS = 366

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine(value => new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value, 'Not a real date')

const ProductionCostsInput = z.object({
  period: z.enum(COST_PERIODS),
  from:   isoDate.optional(),
  to:     isoDate.optional(),
}).strict()

/** A period's first and last business day (Manila), weeks Monday to Sunday as on the dashboard. */
export function periodDates(
  input: z.infer<typeof ProductionCostsInput>,
  today: string,
): { from: string; to: string } | { error: string } {
  const thisWeek  = weekStartOf(today)
  const thisMonth = `${today.slice(0, 7)}-01`
  switch (input.period) {
    case 'today':      return { from: today, to: today }
    case 'this_week':  return { from: thisWeek, to: today }
    case 'last_week':  return { from: addDays(thisWeek, -7), to: addDays(thisWeek, -1) }
    case 'this_month': return { from: thisMonth, to: today }
    case 'last_month': return { from: `${addMonths(today.slice(0, 7), -1)}-01`, to: addDays(thisMonth, -1) }
    case 'custom': {
      const { from, to } = input
      if (!from || !to) return { error: 'A custom period needs both from and to (YYYY-MM-DD).' }
      if (from > to) return { error: 'from must be on or before to.' }
      if (addDays(from, MAX_PERIOD_DAYS) <= to) return { error: `A period can be at most ${MAX_PERIOD_DAYS} days.` }
      return { from, to }
    }
  }
}

function periodLabel(from: string, to: string): string {
  const year = (date: string) => (date.slice(0, 4) === todayIsoDate().slice(0, 4) ? '' : `, ${date.slice(0, 4)}`)
  return from === to
    ? `${shortDateLabel(from)}${year(from)}`
    : `${shortDateLabel(from)}${year(from)} – ${shortDateLabel(to)}${year(to)}`
}

const getProductionCosts = defineTool({
  name: 'get_production_costs',
  description: [
    'Production cost for a period, from the costs recorded when accounting signed off each production run (the figures on the Costing dashboard).',
    'Use it for any question about production cost, spending on production ("gastos"), cost per kg, the cost of batches, or how batches did against their plan.',
    'Returns pesos to the centavo: batchCount and batchCost (signed-off runs); overPlan (what those batches cost beyond what their plan expected for what they made; negative means under plan);',
    'conversionCount and conversionCost (ingredients added when converting one product into another); productionCost (batchCost + conversionCost — the total production cost);',
    'byProduct (per finished good: quantity made, cost, cost per unit — a conversion\'s cost includes the product it was made from, so these do not add up to productionCost);',
    'costliestBatches (up to 5); awaitingSignOff (runs reported done in the period but not yet signed off by accounting, not in the figures).',
    'Weeks run Monday to Sunday; dates are Manila business days. Purchases from suppliers are not production cost.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      period: { type: 'string', enum: [...COST_PERIODS], description: 'Which period. Use custom with from and to for any other range.' },
      from:   { type: 'string', format: 'date', description: 'First day, YYYY-MM-DD. Only with custom.' },
      to:     { type: 'string', format: 'date', description: 'Last day, YYYY-MM-DD, inclusive. Only with custom. At most 366 days after from.' },
    },
    required: ['period'],
    additionalProperties: false,
  },
  input: ProductionCostsInput,
  // The roles of /costing (middleware), whose figures these are.
  roles: [Role.ADMIN, Role.ACCOUNTING, Role.PRODUCTION_MANAGER, Role.VIEWER],
  async run(input) {
    const dates = periodDates(input, todayIsoDate())
    if ('error' in dates) return { ok: false, error: dates.error }
    const data = await CostingService.productionCosts(dates.from, dates.to)
    return { ok: true, label: `production costs, ${periodLabel(dates.from, dates.to)}`, data: { currency: 'PHP', ...data }, query: null }
  },
})

// ─── run_query ───────────────────────────────────────────────────────────────

/** Rows Claude gets back at most (F3). */
export const QUERY_MAX_ROWS = 200
/** A query is stopped after this long. */
export const QUERY_TIMEOUT_MS = 5000
export const QUERY_SQL_MAX = 4000
/** A long text cell (notes, addresses) is cut to this many characters. */
const QUERY_CELL_MAX = 300
/** The rows sent to Claude, as JSON, stop at about this size — wide rows can make 200 too many tokens. */
const QUERY_RESULT_CHARS = 40_000

const RunQueryInput = z.object({
  sql:     z.string().trim().min(1).max(QUERY_SQL_MAX),
  purpose: z.string().trim().min(1).max(80),
}).strict()

/** A database value as JSON: counts come back as bigint, money as Decimal, times as Date. */
function jsonCell(value: unknown): unknown {
  if (typeof value === 'bigint') return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString()
  if (Prisma.Decimal.isDecimal(value)) return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Uint8Array) return '(binary)'
  if (typeof value === 'string' && value.length > QUERY_CELL_MAX) return `${value.slice(0, QUERY_CELL_MAX)}…`
  return value
}

function jsonRows(rows: Record<string, unknown>[]): { rows: Record<string, unknown>[]; cut: boolean } {
  const kept: Record<string, unknown>[] = []
  let size = 0
  for (const row of rows) {
    const converted = Object.fromEntries(Object.entries(row).map(([column, value]) => [column, jsonCell(value)]))
    size += JSON.stringify(converted).length
    if (size > QUERY_RESULT_CHARS) return { rows: kept, cut: true }
    kept.push(converted)
  }
  return { rows: kept, cut: false }
}

const runQuery = defineTool({
  name: 'run_query',
  description: [
    'Runs one read-only PostgreSQL SELECT on the KitchenERP database and returns the rows (at most 200). Use it for questions get_production_costs does not cover: stock, materials, prices, suppliers, purchase requests and orders, deliveries, transfers, lots and expiry, write-offs, production orders, recipes, branches, users.',
    'Rules: one query (WITH … SELECT is fine). Table and column names are case-sensitive: always double-quote them, e.g. SELECT "name" FROM "Material". Name the columns you select (SELECT * fails on "User") and alias computed or duplicate ones. Count, sum and group in SQL rather than fetching many rows. Compare enum columns with quoted text, e.g. "status" = \'COMPLETED\'.',
    'Ids are text (cuid): join on them, but show users names and document numbers, never ids. Money is pesos. Quantities are in the item\'s unit (its unitId → "Unit"."abbreviation").',
    'Times: columns ending in At (createdAt, updatedAt, completedAt, receivedAt, decidedAt, expiresAt) are UTC moments; for a Manila date use ("createdAt" AT TIME ZONE \'UTC\' AT TIME ZONE \'Asia/Manila\')::date. Date-only columns (plannedDate, producedOn, effectiveDate, neededBy, expectedDelivery) hold that date at 00:00: compare them as ::date with no time zone conversion.',
    'Tables (enum values in brackets):',
    '"Branch": id, name, code, type [COMMISSARY, OUTLET], address, phone, managerId (→ User), isActive.',
    '"User": id, name, role [ADMIN, PROCUREMENT_MANAGER, PRODUCTION_MANAGER, BRANCH_MANAGER, ACCOUNTING, VIEWER], branchId, createdAt — only these columns can be read.',
    '"Category": id, name, type (\'RAW_MATERIAL\', \'FINISHED_GOOD\', \'PACKAGING\'). "Unit": id, name, abbreviation.',
    '"Material" (raw materials and packaging): id, code, name, categoryId, unitId, reorderPoint (low stock at or below it), isActive. Ignore standardCost (unused).',
    '"ItemPrice": materialId, supplierId (null = the reference price), unitPrice, effectiveDate. The price on a date is the newest row with effectiveDate on or before it.',
    '"FinishedGood" (cooked products): id, code, name, unitId, sellingPrice, shelfLifeHours, isActive.',
    '"BOM" (recipe versions): id, finishedGoodId, kind [PRODUCTION, CONVERSION], version, isActive, batchSize, batchUnitId, sourceFinishedGoodId, sourceQuantity. "BOMItem": bomId, materialId, quantity (per batch of batchSize), unitId.',
    '"Supplier": id, name, contactName, email, phone, address, isActive.',
    '"PurchaseRequest": id, prNumber, requestedById, status [DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, CONVERTED_TO_PO], neededBy, createdAt. "PurchaseRequestItem": purchaseRequestId, materialId, quantity, estimatedUnitCost.',
    '"PurchaseOrder": id, poNumber, purchaseRequestId, supplierId, status [DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, SENT, PARTIALLY_RECEIVED, FULLY_RECEIVED, CANCELLED], totalAmount, expectedDelivery, createdAt. "PurchaseOrderItem": id, purchaseOrderId, materialId, quantity, unitCost, totalCost.',
    '"ReceivingReport" (deliveries counted in): id, rrNumber, purchaseOrderId, branchId, receivedById, status [DRAFT, PENDING_APPROVAL, APPROVED, REJECTED], receivedAt. "ReceivingReportItem": receivingReportId, purchaseOrderItemId, materialId, orderedQuantity, expectedQuantity, receivedQuantity, rejectedQuantity, unitCost. Only APPROVED reports added stock.',
    '"InventoryLevel": materialId, branchId, quantity — current raw-material stock per branch.',
    '"StockMovement" (raw-material ledger): materialId, branchId, type [IN, OUT, ADJUSTMENT, TRANSFER, WASTE], quantity (signed: + in, − out), unitCost, referenceType, referenceId, createdAt.',
    '"FinishedGoodLot": id, lotNumber, finishedGoodId, productionOrderId, conversionOrderId, producedOn, expiresAt. "FinishedGoodLevel": lotId, branchId, quantity — current finished-goods stock per lot and branch. "FinishedGoodMovement": lotId, branchId, type, quantity (signed), unitCost, referenceType, referenceId, createdAt.',
    '"ProductionOrder": id, orderNumber, finishedGoodId, bomId, branchId, requestedById, status [DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, IN_PROGRESS, PENDING_COMPLETION, COMPLETED, CANCELLED], batchWeight, batchCount, plannedQty, actualQty, plannedDate, completedAt (reported done), plannedCost, actualCost, costPerUnit, costVariance (costs are set once COMPLETED). "ProductionStatusChange": productionOrderId, fromStatus, toStatus, changedById, note, createdAt.',
    '"ConversionOrder": id, orderNumber, finishedGoodId (made), sourceFinishedGoodId (made from), branchId, status [PENDING_APPROVAL, APPROVED, REJECTED], sourceQty, outputQty, sourceCost, conversionCost, costPerUnit, createdAt.',
    '"StockTransfer" (finished goods sent from the commissary to a branch): id, transferNumber, fromBranchId, toBranchId, status [PENDING_APPROVAL, APPROVED (in transit), RECEIVED, REJECTED], varianceValue, varianceReason, createdAt, receivedAt. "StockTransferItem": stockTransferId, finishedGoodId, quantity.',
    '"WriteOff": writeOffNumber, lotId, branchId, status [PENDING_APPROVAL, APPROVED, REJECTED], quantity, reason [EXPIRED, SPOILED, DAMAGED, FAILED_QUALITY, OTHER], unitCost, totalCost, createdAt.',
    '"Approval": referenceType (\'PurchaseRequest\', \'PurchaseOrder\', \'ReceivingReport\', \'ProductionOrder\', \'ProductionCompletion\', \'ConversionOrder\', \'WriteOff\'), referenceId, approverId, decision (\'APPROVED\', \'REJECTED\'), remarks, decidedAt.',
    'Not readable: AI usage, notifications, users\' email addresses and passwords. A permission error means the data is not available to you; say so rather than trying other tables.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      sql:     { type: 'string', description: 'One PostgreSQL SELECT, at most 4000 characters.' },
      purpose: { type: 'string', description: 'What it looks up, in a few plain words for the user, e.g. "users by role" or "pork belly stock".' },
    },
    required: ['sql', 'purpose'],
    additionalProperties: false,
  },
  input: RunQueryInput,
  // ASSISTANT_ROLES: the grants are not per branch (see the migration), so
  // only roles that already see every branch.
  roles: [Role.ADMIN, Role.ACCOUNTING, Role.PRODUCTION_MANAGER],
  available: AiReaderRepository.isConfigured,
  async run({ sql, purpose }) {
    const result = await AiReaderRepository.query(sql, QUERY_MAX_ROWS, QUERY_TIMEOUT_MS)
    if (!result.ok) return { ok: false, error: `The database refused the query: ${result.error}` }
    const { rows, cut } = jsonRows(result.data.rows)
    const truncated = result.data.truncated || cut
    return {
      ok: true,
      label: purpose,
      data: {
        rowCount: rows.length,
        ...(truncated ? { note: 'More rows matched than were returned; count or group in SQL for totals.' } : {}),
        rows,
      },
      query: { sql, rowCount: rows.length, truncated },
    }
  },
})

// ─── draft_purchase_request ──────────────────────────────────────────────────

/** Largest quantity on one drafted line, in the material's unit. */
const DRAFT_QUANTITY_MAX = 100_000

const DraftPurchaseRequestInput = z.object({
  items: z.array(z.object({
    material: z.string().trim().min(1).max(100),
    // At most 3 decimals: the gram, for kg.
    quantity: z.number().positive().max(DRAFT_QUANTITY_MAX)
      .refine(value => Number(value.toFixed(3)) === value, 'At most 3 decimal places'),
    unit:     z.string().trim().min(1).max(30),
  }).strict()).min(1).max(DRAFT_MAX_LINES),
  neededBy: isoDate.optional(),
  notes:    z.string().trim().max(500).optional(),
}).strict()

const draftPurchaseRequest = defineTool({
  name: 'draft_purchase_request',
  description: [
    'Prepares a purchase request for the user to confirm. It creates nothing: the draft is shown under your answer with Confirm and Cancel buttons, and only the user\'s Confirm creates it, as a DRAFT request they then submit for approval.',
    'Use it only when the user asks to order, buy or request materials. One draft per question, with every material on it.',
    'Name each material as the user did (in English, as materials are named in the system); the server finds it. If a name matches several materials or none, you get the candidates: ask the user which one, then draft again.',
    'quantity is in the material\'s own unit; unit is the unit the user gave (e.g. kg). If it is not the material\'s unit you get an error: ask the user for the quantity in that unit, never convert.',
    'Each line is priced at the material\'s current reference price. Returns the draft as saved.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: `The materials, at most ${DRAFT_MAX_LINES}, each once.`,
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            material: { type: 'string', description: 'The material\'s name, e.g. "pork belly".' },
            quantity: { type: 'number', description: `How much, in the material's unit; more than 0, at most ${DRAFT_QUANTITY_MAX}, up to 3 decimals.` },
            unit:     { type: 'string', description: 'The unit the user gave, e.g. "kg" or "L".' },
          },
          required: ['material', 'quantity', 'unit'],
          additionalProperties: false,
        },
      },
      neededBy: { type: 'string', format: 'date', description: 'When it is needed, YYYY-MM-DD, today or later. Only if the user said.' },
      notes:    { type: 'string', description: 'A note for the approver, at most 500 characters. Only if the user gave one.' },
    },
    required: ['items'],
    additionalProperties: false,
  },
  input: DraftPurchaseRequestInput,
  kind: 'draft',
  // Week 9 Task 5, I5: the kitchen's planners. Re-checked at Confirm.
  roles: ACTION_ROLES,
  async run(input, context) {
    const outcome = await AssistantActionService.draftPurchaseRequest(input, context)
    return outcome.ok
      ? { ok: true, label: 'purchase request draft', data: outcome.summary, query: null }
      : { ok: false, error: outcome.error }
  },
})

// ─── draft_production_order ──────────────────────────────────────────────────

/** Largest batch weight Claude may set, in the product's unit. */
const DRAFT_BATCH_WEIGHT_MAX = 1000

const DraftProductionOrderInput = z.object({
  product:     z.string().trim().min(1).max(100),
  batches:     z.number().int().min(1).max(MAX_BATCH_COUNT),
  plannedDate: isoDate,
  batchWeight: z.number().positive().max(DRAFT_BATCH_WEIGHT_MAX)
    .refine(value => Number(value.toFixed(3)) === value, 'At most 3 decimal places').optional(),
  notes:       z.string().trim().max(500).optional(),
}).strict()

const draftProductionOrder = defineTool({
  name: 'draft_production_order',
  description: [
    'Prepares a production order (a planned cooking run) for the user to confirm. It creates nothing: the draft is shown under your answer with Confirm and Cancel buttons, and only the user\'s Confirm creates it, as a DRAFT order they then submit for approval.',
    'Use it only when the user asks to plan, cook or produce something. One draft per question.',
    'Name the product as the user did (e.g. "Bopis"); the server finds it. If the name matches several products or none, you get the candidates: ask the user which one, then draft again.',
    'It is cooked at the main kitchen (Main Commissary). batches is how many batches; each batch is the recipe\'s batch size unless the user gave a weight per batch. If the user gave a total amount instead, ask how many batches.',
    'plannedDate is required: if the user did not say when, ask; never assume a date.',
    'Returns the draft as saved, with the ingredients that are short at the kitchen right now.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      product:     { type: 'string', description: 'The product\'s name, e.g. "Bopis".' },
      batches:     { type: 'integer', description: `How many batches, 1 to ${MAX_BATCH_COUNT}.` },
      plannedDate: { type: 'string', format: 'date', description: 'The day to cook, YYYY-MM-DD, today or later.' },
      batchWeight: { type: 'number', description: 'Weight of one batch in the product\'s unit, only if the user gave one. Leave it out to use the recipe\'s batch size.' },
      notes:       { type: 'string', description: 'A note on the order, at most 500 characters. Only if the user gave one.' },
    },
    required: ['product', 'batches', 'plannedDate'],
    additionalProperties: false,
  },
  input: DraftProductionOrderInput,
  kind: 'draft',
  // Week 9 Task 5, I5. ProductionOrderService.create checks the role again at Confirm.
  roles: ACTION_ROLES,
  async run(input, context) {
    const outcome = await AssistantActionService.draftProductionOrder(input, context)
    return outcome.ok
      ? { ok: true, label: 'production order draft', data: outcome.summary, query: null }
      : { ok: false, error: outcome.error }
  },
})

// ─── Registry ────────────────────────────────────────────────────────────────

const TOOLS: readonly AssistantTool[] = [getProductionCosts, runQuery, draftPurchaseRequest, draftProductionOrder]

/** The tools offered to a role (F2), among those the server is set up for. */
export function toolsFor(role: string): AssistantTool[] {
  return TOOLS.filter(tool => tool.available() && tool.roles.some(allowed => allowed === role))
}
