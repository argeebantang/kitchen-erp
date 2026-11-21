import { AiActionStatus, AiActionType, BomKind, BranchType, Prisma, Role } from '@prisma/client'
import { z } from 'zod'
import { toDecimal, toDecimalString } from '@/lib/decimal'
import { todayIsoDate } from '@/lib/dates'
import { ProductionOrderService } from '@/services/production-order.service'
import { PurchaseRequestService } from '@/services/purchase-request.service'
import { AiQueryRepository, type AiActionRow } from '@/repositories/ai-query.repository'
import { BomRepository } from '@/repositories/bom.repository'
import { BranchRepository } from '@/repositories/branch.repository'
import { FinishedGoodRepository } from '@/repositories/finished-good.repository'
import { ItemPriceRepository } from '@/repositories/item-price.repository'
import { MaterialRepository, type MaterialWithRelations } from '@/repositories/material.repository'

/**
 * The assistant's write actions (Week 9 Task 5,
 * docs/2026-11-20-week9-ai-write-actions.md). Claude only drafts (I1, I9): a
 * draft is checked and stored on its question's AiQuery row (I2), the card
 * shows it, and only the asker's Confirm creates the document, through the
 * same service as the form, as a DRAFT they then submit as usual (I3).
 */

/** Who may draft and confirm (I5). Re-checked at Confirm: the role may have changed since the draft. */
export const ACTION_ROLES: readonly Role[] = [Role.ADMIN, Role.PRODUCTION_MANAGER]

export function canDraft(role: string): boolean {
  return ACTION_ROLES.some(allowed => allowed === role)
}

/** A draft can be confirmed for this long after Claude proposed it (I7). */
export const ACTION_TTL_HOURS = 24
const ACTION_TTL_MS = ACTION_TTL_HOURS * 60 * 60 * 1000

/** Lines on one drafted purchase request. */
export const DRAFT_MAX_LINES = 20
/** Candidates named back to Claude when a material name is ambiguous (I4). */
const MATCH_LIMIT = 8

/** EXPIRED is derived — a PROPOSED draft past ACTION_TTL_HOURS — never stored (I8). */
export type AssistantActionStatus = 'PROPOSED' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED'

export type PurchaseRequestDraftLineDto = {
  materialName: string
  materialCode: string
  unit: string
  quantity: string
  /** The reference price when drafted; null when the material has none. */
  estimatedUnitCost: string | null
  lineTotal: string | null
}

export type PurchaseRequestDraftDto = {
  lines: PurchaseRequestDraftLineDto[]
  /** Null if any line is unpriced, as on a purchase request. */
  estimatedTotal: string | null
  /** YYYY-MM-DD. */
  neededBy: string | null
  notes: string | null
}

/** One ingredient of a drafted run, with the stock check as it was when drafted. */
export type ProductionOrderRequirementDto = {
  materialName: string
  unit: string
  /** For the whole run. */
  total: string
  /** On hand minus what approved runs still need, at the kitchen. */
  available: string
  /** 0 when there is enough. */
  short: string
}

export type ProductionOrderDraftDto = {
  finishedGoodName: string
  finishedGoodCode: string
  unit: string
  /** The active recipe when drafted; Confirm pins whichever is active then, as the form does. */
  bomVersion: number
  batchWeight: string
  batchCount: number
  plannedQty: string
  /** YYYY-MM-DD. */
  plannedDate: string
  branchName: string
  notes: string | null
  requirements: ProductionOrderRequirementDto[]
  /** Ingredients short when drafted. */
  shortages: number
}

/** A drafted action as the card shows it; `id` is its question's AiQuery id. */
export type AssistantActionDto = {
  id: string
  status: AssistantActionStatus
  /** ISO. When a PROPOSED draft stops being confirmable. */
  expiresAt: string
  /** The document Confirm created. */
  document: { number: string; href: string } | null
  /** ISO. When Confirm or Cancel was pressed; set while a Confirm is in progress too. */
  decidedAt: string | null
} & (
  | { type: 'PURCHASE_REQUEST'; draft: PurchaseRequestDraftDto }
  | { type: 'PRODUCTION_ORDER'; draft: ProductionOrderDraftDto }
)

/** Where a drafting tool runs: who is asking, and the question its draft is stored on (null if the log could not be started). */
export type DraftContext = { userId: string; role: string; queryId: string | null }

export type DraftOutcome = { ok: true; summary: unknown } | { ok: false; error: string }

export type ActionDecision = 'confirm' | 'cancel'

export type AssistantActionResult =
  | { success: true; data: AssistantActionDto }
  | { success: false; error: string; status: number; action: AssistantActionDto | null }

// What is stored in actionDraft: exactly what Confirm creates. Checked again
// when read back, so a malformed row cannot be confirmed.
const PurchaseRequestDraftSchema = z.object({
  lines: z.array(z.object({
    materialId:        z.string(),
    materialCode:      z.string(),
    materialName:      z.string(),
    unit:              z.string(),
    quantity:          z.string(),
    estimatedUnitCost: z.string().nullable(),
  })).min(1),
  neededBy: z.string().nullable(),
  notes:    z.string().nullable(),
})

type PurchaseRequestDraft = z.infer<typeof PurchaseRequestDraftSchema>

const ProductionOrderDraftSchema = z.object({
  finishedGoodId:   z.string(),
  finishedGoodCode: z.string(),
  finishedGoodName: z.string(),
  unit:             z.string(),
  bomVersion:       z.number().int(),
  batchWeight:      z.string(),
  batchCount:       z.number().int(),
  plannedQty:       z.string(),
  plannedDate:      z.string(),
  branchId:         z.string(),
  branchName:       z.string(),
  notes:            z.string().nullable(),
  requirements: z.array(z.object({
    materialName: z.string(),
    unit:         z.string(),
    total:        z.string(),
    available:    z.string(),
    short:        z.string(),
  })),
})

type ProductionOrderDraft = z.infer<typeof ProductionOrderDraftSchema>

export type PurchaseRequestDraftInput = {
  items: { material: string; quantity: number; unit: string }[]
  neededBy?: string
  notes?: string
}

export type ProductionOrderDraftInput = {
  product: string
  batches: number
  plannedDate: string
  /** The central kitchen as the user named it; optional when only one is active. */
  kitchen?: string
  batchWeight?: number
  notes?: string
}

// ─── Drafting ────────────────────────────────────────────────────────────────

type Named = { name: string; code: string }

/** The words of a name, lower-cased, without punctuation or 1-letter words. */
function wordsOf(term: string): string[] {
  return term.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 2)
}

/** Words that say "a kitchen" without saying which one ("sa kitchen", "the commissary"). */
const KITCHEN_FILLER = new Set(['kitchen', 'kitchens', 'commissary', 'central', 'branch', 'the', 'sa', 'ng'])

type Kitchen = { id: string; name: string }
type KitchenMatch = { ok: true; kitchen: Kitchen } | { ok: false; error: string }

/**
 * The central kitchen a run is planned at (Week 9 Task 7, K1–K3): production
 * happens only at commissaries, and there can be several. The one the user
 * named (exact name or code, or the only kitchen containing every word); the
 * only active one when the user named none; otherwise an error listing the
 * kitchens, for Claude to ask which. Naming an outlet is refused: outlets do
 * not cook.
 */
async function matchKitchen(term: string | undefined): Promise<KitchenMatch> {
  const branches = await BranchRepository.findAllActiveWithType()
  const kitchens = branches.filter(branch => branch.type === BranchType.COMMISSARY)
  const kitchenList = kitchens.map(kitchen => kitchen.name).join(', ')
  const [onlyKitchen] = kitchens
  if (!onlyKitchen) return { ok: false, error: 'There is no active central kitchen to cook in. Tell the user.' }

  const words = wordsOf(term ?? '').filter(word => !KITCHEN_FILLER.has(word))
  if (words.length === 0) {
    return kitchens.length === 1
      ? { ok: true, kitchen: onlyKitchen }
      : { ok: false, error: `There are ${kitchens.length} central kitchens: ${kitchenList}. Ask the user which kitchen will cook it.` }
  }

  const wanted = (term ?? '').trim().toLowerCase()
  const containsAll = (branch: Named) => {
    const text = `${branch.name} ${branch.code}`.toLowerCase()
    return words.every(word => text.includes(word))
  }
  const exact = branches.find(branch => branch.name.toLowerCase() === wanted || branch.code.toLowerCase() === wanted)
  const matches = exact ? [exact] : kitchens.filter(containsAll)
  const [match] = matches

  if (match && matches.length === 1 && match.type === BranchType.COMMISSARY) return { ok: true, kitchen: match }
  if (matches.length > 1) {
    return { ok: false, error: `"${term}" matches several kitchens: ${matches.map(m => m.name).join(', ')}. Ask the user which one.` }
  }
  const outlet = match ?? branches.find(branch => branch.type === BranchType.OUTLET && containsAll(branch))
  if (outlet) {
    return { ok: false, error: `${outlet.name} is an outlet, and outlets do not cook. Runs are planned at a central kitchen: ${kitchenList}. Ask the user which one.` }
  }
  return { ok: false, error: `No central kitchen is called "${term}". The kitchens are: ${kitchenList}. Ask the user which one.` }
}

type NameSearch<T> = (words: string[], match: 'all' | 'any', take: number) => Promise<T[]>
type Match<T> = { ok: true; item: T } | { ok: false; error: string }

/**
 * The one active material or product a name means (I4): an exact name or
 * code, or the only one containing every word. Otherwise an error naming the
 * candidates, for Claude to ask the user which one.
 */
async function matchByName<T extends Named>(term: string, noun: string, search: NameSearch<T>): Promise<Match<T>> {
  const words = wordsOf(term)
  if (words.length === 0) return { ok: false, error: `"${term}" is not a ${noun} name.` }

  const matches = await search(words, 'all', MATCH_LIMIT + 1)
  const wanted = term.trim().toLowerCase()
  const exact = matches.find(item => item.name.toLowerCase() === wanted || item.code.toLowerCase() === wanted)
  if (exact) return { ok: true, item: exact }
  const [only] = matches
  if (only && matches.length === 1) return { ok: true, item: only }

  const names = (list: T[]) =>
    list.slice(0, MATCH_LIMIT).map(item => item.name).join(', ') + (list.length > MATCH_LIMIT ? ', and more' : '')
  if (matches.length > 1) {
    return { ok: false, error: `"${term}" matches several ${noun}s: ${names(matches)}. Ask the user which one they mean.` }
  }
  const near = await search(words, 'any', MATCH_LIMIT + 1)
  return {
    ok: false,
    error: near.length > 0
      ? `No ${noun} is called "${term}". Similar names: ${names(near)}. Ask the user which one they mean.`
      : `No active ${noun} matches "${term}". Ask the user for the name as it appears in the system.`,
  }
}

/** The unit the user gave is the material's: its abbreviation or name ("kg", "kilogram", "kilograms"). */
function sameUnit(material: MaterialWithRelations, given: string): boolean {
  const unit = given.trim().toLowerCase()
  const { abbreviation, name } = material.unit
  return [abbreviation, name, `${name}s`].some(candidate => candidate.toLowerCase() === unit)
}

function purchaseRequestDraftDto(draft: PurchaseRequestDraft): PurchaseRequestDraftDto {
  let total: Prisma.Decimal | null = new Prisma.Decimal(0)
  const lines = draft.lines.map(line => {
    const lineTotal = line.estimatedUnitCost === null ? null : toDecimal(line.estimatedUnitCost).mul(toDecimal(line.quantity))
    total = lineTotal === null || total === null ? null : total.add(lineTotal)
    return {
      materialName:      line.materialName,
      materialCode:      line.materialCode,
      unit:              line.unit,
      quantity:          line.quantity,
      estimatedUnitCost: line.estimatedUnitCost,
      lineTotal:         lineTotal === null ? null : toDecimalString(lineTotal),
    }
  })
  return { lines, estimatedTotal: total === null ? null : toDecimalString(total), neededBy: draft.neededBy, notes: draft.notes }
}

/**
 * draft_purchase_request (I1, I4, I6): matches the materials, checks the
 * units, prices each line at its reference price and stores the draft on the
 * question. Creates nothing. Every problem is returned at once, for Claude to
 * ask the user about.
 */
async function draftPurchaseRequest(input: PurchaseRequestDraftInput, context: DraftContext): Promise<DraftOutcome> {
  if (context.queryId === null) {
    return { ok: false, error: 'Drafts cannot be saved right now. Tell the user to try again in a moment.' }
  }
  if (!canDraft(context.role)) return { ok: false, error: 'This user cannot draft documents.' }
  if (input.neededBy !== undefined && input.neededBy < todayIsoDate()) {
    return { ok: false, error: `neededBy ${input.neededBy} is in the past. Ask the user when they need it.` }
  }

  const matched = await Promise.all(input.items.map(item => matchByName(item.material, 'material', MaterialRepository.searchActive)))
  const errors: string[] = []
  const lines: { material: MaterialWithRelations; quantity: number }[] = []
  input.items.forEach((item, index) => {
    const match = matched[index]
    if (!match) return
    if (!match.ok) {
      errors.push(match.error)
    } else if (!sameUnit(match.item, item.unit)) {
      const { abbreviation, name } = match.item.unit
      errors.push(`${match.item.name} is counted in ${abbreviation} (${name}), not "${item.unit}". Ask the user for the quantity in ${abbreviation}; never convert it yourself.`)
    } else if (lines.some(line => line.material.id === match.item.id)) {
      errors.push(`${match.item.name} is on more than one line; put it on one line with the total quantity.`)
    } else {
      lines.push({ material: match.item, quantity: item.quantity })
    }
  })
  if (errors.length > 0) return { ok: false, error: `Nothing was drafted. ${errors.join(' ')}` }

  const prices = await ItemPriceRepository.findPricesAsOf(lines.map(line => line.material.id), new Date())
  const draft: PurchaseRequestDraft = {
    lines: lines.map(({ material, quantity }) => {
      const price = prices.get(material.id)
      return {
        materialId:        material.id,
        materialCode:      material.code,
        materialName:      material.name,
        unit:              material.unit.abbreviation,
        quantity:          String(quantity),
        estimatedUnitCost: price ? toDecimalString(price.unitPrice) : null,
      }
    }),
    neededBy: input.neededBy ?? null,
    notes:    input.notes?.trim() || null,
  }

  const stored = await AiQueryRepository.proposeAction(context.queryId, AiActionType.PURCHASE_REQUEST, draft)
  if (!stored) {
    return { ok: false, error: 'This question already has a draft, and there can be only one per question. Tell the user to confirm or cancel it, then ask again for another.' }
  }

  const dto = purchaseRequestDraftDto(draft)
  return {
    ok: true,
    summary: {
      result: 'Draft saved. Nothing has been created: the user confirms or cancels it below your answer.',
      currency: 'PHP',
      lines: dto.lines.map(line => ({
        material:          line.materialName,
        quantity:          `${line.quantity} ${line.unit}`,
        estimatedUnitCost: line.estimatedUnitCost,
        lineTotal:         line.lineTotal,
      })),
      estimatedTotal: dto.estimatedTotal,
      neededBy:       dto.neededBy,
      notes:          dto.notes,
    },
  }
}

function productionOrderDraftDto(draft: ProductionOrderDraft): ProductionOrderDraftDto {
  return {
    finishedGoodName: draft.finishedGoodName,
    finishedGoodCode: draft.finishedGoodCode,
    unit:             draft.unit,
    bomVersion:       draft.bomVersion,
    batchWeight:      draft.batchWeight,
    batchCount:       draft.batchCount,
    plannedQty:       draft.plannedQty,
    plannedDate:      draft.plannedDate,
    branchName:       draft.branchName,
    notes:            draft.notes,
    requirements:     draft.requirements,
    shortages:        draft.requirements.filter(line => toDecimal(line.short).greaterThan(0)).length,
  }
}

/**
 * draft_production_order (I1, I4, I6): matches the product, takes the batch
 * size from its active recipe unless the user gave one, plans it at the
 * central kitchen the user named (matchKitchen), checks it under the same
 * rules as Create, and stores it with the ingredient check (shortages) as of
 * now. Creates nothing.
 */
async function draftProductionOrder(input: ProductionOrderDraftInput, context: DraftContext): Promise<DraftOutcome> {
  if (context.queryId === null) {
    return { ok: false, error: 'Drafts cannot be saved right now. Tell the user to try again in a moment.' }
  }
  if (!canDraft(context.role)) return { ok: false, error: 'This user cannot draft documents.' }

  const match = await matchByName(input.product, 'product', FinishedGoodRepository.searchActive)
  if (!match.ok) return { ok: false, error: `Nothing was drafted. ${match.error}` }
  const good = match.item

  const [bom, kitchenMatch] = await Promise.all([
    BomRepository.findActiveByFinishedGood(good.id, BomKind.PRODUCTION),
    matchKitchen(input.kitchen),
  ])
  if (!bom) return { ok: false, error: `Nothing was drafted. ${good.name} has no active recipe, so it cannot be planned. Tell the user.` }
  if (!kitchenMatch.ok) return { ok: false, error: `Nothing was drafted. ${kitchenMatch.error}` }
  const { kitchen } = kitchenMatch

  const order = {
    finishedGoodId: good.id,
    batchWeight:    input.batchWeight === undefined ? toDecimalString(bom.batchSize) : String(input.batchWeight),
    batchCount:     input.batches,
    plannedDate:    input.plannedDate,
    branchId:       kitchen.id,
    notes:          input.notes?.trim() || null,
  }
  // The rules Create applies (recipe units, batch count, date not past), so
  // nothing is drafted that Confirm would refuse.
  const checked = await ProductionOrderService.check(order)
  if (!checked.success) return { ok: false, error: `Nothing was drafted. ${checked.error}.` }
  const preview = await ProductionOrderService.previewRequirements(order)
  if (!preview.success) return { ok: false, error: `Nothing was drafted. ${preview.error}.` }

  const draft: ProductionOrderDraft = {
    finishedGoodId:   good.id,
    finishedGoodCode: good.code,
    finishedGoodName: good.name,
    unit:             good.unit.abbreviation,
    bomVersion:       preview.data.bomVersion,
    batchWeight:      preview.data.batchWeight,
    batchCount:       order.batchCount,
    plannedQty:       preview.data.plannedQty,
    plannedDate:      order.plannedDate,
    branchId:         kitchen.id,
    branchName:       kitchen.name,
    notes:            order.notes,
    requirements: preview.data.lines.map(line => ({
      materialName: line.materialName,
      unit:         line.unitAbbreviation,
      total:        line.total,
      available:    line.stock?.available ?? '0',
      short:        line.stock?.short ?? '0',
    })),
  }

  const stored = await AiQueryRepository.proposeAction(context.queryId, AiActionType.PRODUCTION_ORDER, draft)
  if (!stored) {
    return { ok: false, error: 'This question already has a draft, and there can be only one per question. Tell the user to confirm or cancel it, then ask again for another.' }
  }

  const dto = productionOrderDraftDto(draft)
  const short = dto.requirements.filter(line => toDecimal(line.short).greaterThan(0))
  return {
    ok: true,
    summary: {
      result:      'Draft saved. Nothing has been created: the user confirms or cancels it below your answer.',
      product:     dto.finishedGoodName,
      batches:     `${dto.batchCount} × ${dto.batchWeight} ${dto.unit}`,
      plannedQty:  `${dto.plannedQty} ${dto.unit}`,
      plannedDate: dto.plannedDate,
      kitchen:     dto.branchName,
      notes:       dto.notes,
      shortages:   short.map(line => ({
        material:  line.materialName,
        needs:     `${line.total} ${line.unit}`,
        available: `${line.available} ${line.unit}`,
        short:     `${line.short} ${line.unit}`,
      })),
      stock: short.length > 0
        ? 'Tell the user which ingredients are short. They can ask you for a purchase request for them in their next message.'
        : 'Stock covers every ingredient.',
    },
  }
}

// ─── Showing and deciding ────────────────────────────────────────────────────

function documentHref(type: AiActionType, id: string): string {
  switch (type) {
    case AiActionType.PURCHASE_REQUEST: return `/procurement/requests/${id}`
    case AiActionType.PRODUCTION_ORDER: return `/production/orders/${id}`
  }
}

/** A question's drafted action as the card and the admin log show it; null when it has none (or its draft cannot be read). */
function toDto(row: AiActionRow): AssistantActionDto | null {
  if (row.actionType === null || row.actionStatus === null || row.actionProposedAt === null) return null
  const expiresAt = new Date(row.actionProposedAt.getTime() + ACTION_TTL_MS)
  const base = {
    id:        row.id,
    status:    row.actionStatus === AiActionStatus.PROPOSED && expiresAt.getTime() <= Date.now() ? 'EXPIRED' : row.actionStatus,
    expiresAt: expiresAt.toISOString(),
    document:  row.actionDocumentId !== null && row.actionDocumentNumber !== null
      ? { number: row.actionDocumentNumber, href: documentHref(row.actionType, row.actionDocumentId) }
      : null,
    decidedAt: row.actionDecidedAt?.toISOString() ?? null,
  } satisfies Omit<AssistantActionDto, 'type' | 'draft'>

  switch (row.actionType) {
    case AiActionType.PURCHASE_REQUEST: {
      const draft = PurchaseRequestDraftSchema.safeParse(row.actionDraft)
      return draft.success ? { ...base, type: 'PURCHASE_REQUEST', draft: purchaseRequestDraftDto(draft.data) } : null
    }
    case AiActionType.PRODUCTION_ORDER: {
      const draft = ProductionOrderDraftSchema.safeParse(row.actionDraft)
      return draft.success ? { ...base, type: 'PRODUCTION_ORDER', draft: productionOrderDraftDto(draft.data) } : null
    }
  }
}

/** The action drafted on a question, for the answer it came with; null if none. */
async function forQuery(queryId: string): Promise<AssistantActionDto | null> {
  const row = await AiQueryRepository.findAction(queryId)
  return row ? toDto(row) : null
}

type Created = { ok: true; id: string; number: string } | { ok: false; error: string; status: number }

/** Creates the drafted document as the asker, through the same service as the form (I3). */
async function createDocument(row: AiActionRow, viewer: { userId: string; role: string }): Promise<Created> {
  const unreadable: Created = { ok: false, error: 'This draft can no longer be read. Ask again for a new one.', status: 422 }
  switch (row.actionType) {
    case AiActionType.PURCHASE_REQUEST: {
      const parsed = PurchaseRequestDraftSchema.safeParse(row.actionDraft)
      if (!parsed.success) return unreadable
      const draft = parsed.data
      const result = await PurchaseRequestService.create({
        requestedById: row.userId,
        neededBy:      draft.neededBy,
        notes:         draft.notes,
        // The price shown on the draft is the one saved, so what was confirmed is what is created.
        items: draft.lines.map(line => ({ materialId: line.materialId, quantity: line.quantity, estimatedUnitCost: line.estimatedUnitCost })),
      })
      return result.success
        ? { ok: true, id: result.data.id, number: result.data.prNumber }
        : { ok: false, error: result.error, status: result.status }
    }
    case AiActionType.PRODUCTION_ORDER: {
      const parsed = ProductionOrderDraftSchema.safeParse(row.actionDraft)
      if (!parsed.success) return unreadable
      const draft = parsed.data
      // create() checks the role again and pins whichever recipe is active now, as the form does.
      const result = await ProductionOrderService.create({
        finishedGoodId: draft.finishedGoodId,
        batchWeight:    draft.batchWeight,
        batchCount:     draft.batchCount,
        plannedDate:    draft.plannedDate,
        branchId:       draft.branchId,
        notes:          draft.notes,
      }, viewer)
      return result.success
        ? { ok: true, id: result.data.id, number: result.data.orderNumber }
        : { ok: false, error: result.error, status: result.status }
    }
    case null:
      return unreadable
  }
}

/** Why a draft could not be claimed: decided already, being confirmed, or expired. */
function notClaimable(row: AiActionRow): AssistantActionResult {
  const action = toDto(row)
  if (row.actionStatus === AiActionStatus.CONFIRMED) {
    return { success: false, status: 409, error: `Already confirmed: ${row.actionDocumentNumber ?? 'the document'} was created.`, action }
  }
  if (row.actionStatus === AiActionStatus.CANCELLED) {
    return { success: false, status: 409, error: 'This draft was cancelled.', action }
  }
  if (row.actionDecidedAt !== null) {
    return { success: false, status: 409, error: 'This draft is already being confirmed.', action }
  }
  return { success: false, status: 410, error: 'This draft has expired. Ask again for a new one.', action }
}

/**
 * Confirm or Cancel on the card (I1, I7): only the asker, once, within
 * ACTION_TTL_HOURS. The claim makes a double click create one document; a
 * failed create gives the claim back so Confirm can be tried again.
 */
async function decide(id: string, decision: ActionDecision, viewer: { userId: string; role: string }): Promise<AssistantActionResult> {
  if (!canDraft(viewer.role)) {
    return { success: false, status: 403, error: 'Your role cannot create documents from the assistant.', action: null }
  }

  const claimed = await AiQueryRepository.claimAction(id, viewer.userId, new Date(Date.now() - ACTION_TTL_MS))
  const row = await AiQueryRepository.findAction(id)
  // Someone else's draft is "not found", not "forbidden": its existence is not theirs to know.
  if (!row || row.userId !== viewer.userId || row.actionType === null) {
    return { success: false, status: 404, error: 'Draft not found', action: null }
  }
  if (!claimed) return notClaimable(row)

  if (decision === 'cancel') {
    await AiQueryRepository.completeAction(id, { status: AiActionStatus.CANCELLED })
  } else {
    let created: Created
    try {
      created = await createDocument(row, viewer)
    } catch (error) {
      await AiQueryRepository.releaseAction(id)
      throw error
    }
    if (!created.ok) {
      await AiQueryRepository.releaseAction(id)
      return { success: false, status: created.status, error: created.error, action: toDto(row) }
    }
    const recorded = await AiQueryRepository.completeAction(id, {
      status: AiActionStatus.CONFIRMED, documentId: created.id, documentNumber: created.number,
    })
    // The document exists; the claim stays, so it cannot be created twice.
    if (!recorded) console.error(`[AI] created ${created.number} but could not record it on action ${id}`)
  }

  const decided = await AiQueryRepository.findAction(id)
  const action = decided ? toDto(decided) : null
  return action
    ? { success: true, data: action }
    : { success: false, status: 500, error: 'Internal server error', action: null }
}

export const AssistantActionService = { draftPurchaseRequest, draftProductionOrder, forQuery, decide, toDto }
