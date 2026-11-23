import { ProductionStatus } from '@prisma/client'
import { addDays, monthLabel, shortDateLabel, todayIsoDate } from '@/lib/dates'
import { formatPeso, trimDecimal } from '@/lib/format'
import { BranchRepository } from '@/repositories/branch.repository'
import { DashboardRepository } from '@/repositories/dashboard.repository'
import { canUseAssistant } from '@/services/assistant.service'
import { CostVarianceService } from '@/services/cost-variance.service'
import { DemandForecastService } from '@/services/demand-forecast.service'
import { InventoryService, reorderAlerts } from '@/services/inventory.service'
import { ReorderService } from '@/services/reorder.service'
import type { SupplierDashboardDto } from '@/services/supplier-performance.service'
import type { WasteDashboardDto } from '@/services/waste-pattern.service'

/**
 * The Dashboard's figures (Week 10 Task 7): the four stat cards, which were
 * placeholders until now, and "KitchenAI at a glance" — one tile per AI
 * feature, so the head office sees all seven (the Week 10 deliverable). Each
 * tile is a headline worked out by the code and a link to where the feature
 * lives; nothing here calls Claude. Every part is limited to the roles that
 * can open what it links to.
 */

export type Viewer = { userId: string; role: string }

export type DashboardStatDto = {
  key: 'requests' | 'runs' | 'expiry' | 'reorder'
  label: string
  value: string
  note: string
  /** Null when the viewer's role cannot open the page. */
  href: string | null
  /** 'alert' when the number needs someone's attention. */
  tone: 'neutral' | 'alert' | 'good'
}

export type KitchenAiTileDto = {
  /** The roadmap's number, 1–7. */
  feature: number
  title: string
  headline: string
  detail: string | null
  href: string | null
  linkLabel: string | null
}

const PRODUCTION_ROLES = ['ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTING']
const APPROVER_ROLES = ['ADMIN', 'ACCOUNTING']
const PROCUREMENT_ROLES = ['ADMIN', 'PROCUREMENT_MANAGER', 'BRANCH_MANAGER', 'PRODUCTION_MANAGER', 'ACCOUNTING']
/** Raw materials are a kitchen matter; a branch manager runs an outlet. */
const STOCK_ROLES = ['ADMIN', 'PROCUREMENT_MANAGER', 'PRODUCTION_MANAGER', 'ACCOUNTING', 'VIEWER']

const DONE: ProductionStatus[] = [ProductionStatus.PENDING_COMPLETION, ProductionStatus.COMPLETED]

type StockMap = Awaited<ReturnType<typeof InventoryService.stockMap>>

async function stats(viewer: Viewer, map: StockMap): Promise<DashboardStatDto[]> {
  const today = todayIsoDate()
  const [awaiting, runs, finished] = await Promise.all([
    DashboardRepository.purchaseRequestsAwaitingApproval(),
    DashboardRepository.runsOn(today),
    InventoryService.finishedGoodStock({}, viewer),
  ])
  const count = (statuses: ProductionStatus[]) => runs.filter(row => statuses.includes(row.status)).reduce((n, row) => n + row.count, 0)
  const runsTotal = runs.reduce((n, row) => n + row.count, 0)
  const runsDone = count(DONE)
  const cooking = count([ProductionStatus.IN_PROGRESS])
  const { expired, within24h, within48h } = finished.expiryCounts
  const alerts = reorderAlerts(map)
  const out = alerts.filter(alert => alert.status === 'OUT').length

  return [
    {
      key:   'requests',
      label: 'Purchase requests to approve',
      value: String(awaiting),
      note:  awaiting === 0 ? 'nothing waiting' : 'awaiting accounting',
      href:  APPROVER_ROLES.includes(viewer.role) ? '/procurement/approvals' : PROCUREMENT_ROLES.includes(viewer.role) ? '/procurement/requests' : null,
      tone:  awaiting > 0 ? 'alert' : 'good',
    },
    {
      key:   'runs',
      label: 'Production runs today',
      value: String(runsTotal),
      note:  runsTotal === 0 ? 'none planned' : `${runsDone} done · ${cooking} cooking · ${runsTotal - runsDone - cooking} to start`,
      href:  PRODUCTION_ROLES.includes(viewer.role) ? '/production/schedule' : null,
      tone:  'neutral',
    },
    {
      key:   'expiry',
      label: 'Finished-goods lots to use first',
      value: String(expired + within24h + within48h),
      note:  `${expired} expired · ${within24h + within48h} expiring within 48 h`,
      href:  '/inventory/finished-goods?expiry=48h',
      tone:  expired > 0 ? 'alert' : 'neutral',
    },
    {
      key:   'reorder',
      label: 'Raw materials to reorder',
      value: String(alerts.length),
      note:  alerts.length === 0 ? 'every kitchen stocked' : `${out} out · ${alerts.length - out} low, at the kitchens`,
      href:  '/inventory/stock',
      tone:  alerts.length > 0 ? 'alert' : 'good',
    },
  ]
}

/** Feature 1: the latest signed-off run against the one before. */
async function costVarianceTile(): Promise<KitchenAiTileDto> {
  const base = { feature: 1, title: 'Cost variance explainer' }
  const run = await DashboardRepository.latestCompletedRun()
  if (!run) return { ...base, headline: 'No run signed off yet.', detail: null, href: null, linkLabel: null }
  const [costs, insight] = await Promise.all([CostVarianceService.comparison(run.id), CostVarianceService.insight(run.id)])
  if (!costs) return { ...base, headline: `${run.orderNumber} has no recorded cost.`, detail: null, href: `/production/orders/${run.id}`, linkLabel: 'Open the order' }
  const sign = costs.change.startsWith('-') ? '' : '+'
  return {
    ...base,
    headline: `${run.orderNumber} · ${run.finishedGood.name} at ${run.branch.name}: ${formatPeso(costs.current.costPerUnit)}/${costs.unitAbbreviation}, ${sign}${costs.percentChange}% vs ${costs.basis === 'PLAN' ? 'its plan' : 'the previous batch'}.`,
    detail:   insight?.status === 'READY' ? 'Explained by KitchenAI.' : 'Not explained yet — open the order.',
    href:     `/production/orders/${run.id}`,
    linkLabel: 'Open the latest run',
  }
}

/** Feature 4: what needs ordering, the most urgent first. */
async function reorderTile(map: StockMap): Promise<KitchenAiTileDto> {
  const base = { feature: 4, title: 'Reorder recommender', href: '/inventory/stock', linkLabel: 'Open the stock map' }
  const recommendations = Object.values(await ReorderService.forAlerts(reorderAlerts(map)))
  const toOrder = recommendations
    .filter(rec => rec.orderNeeded)
    .sort((a, b) => b.lateByDays - a.lateByDays || a.orderBy.localeCompare(b.orderBy))
  if (toOrder.length === 0) {
    return { ...base, headline: recommendations.length === 0 ? 'Nothing at or below its reorder point.' : 'Everything low is already on order.', detail: null }
  }
  const [first] = toOrder
  const when = first.orderBy === first.today ? 'today' : `by ${shortDateLabel(first.orderBy)}`
  return {
    ...base,
    headline: `${toOrder.length} to order. First: ${first.materialName} at ${first.branchName}, ${trimDecimal(first.recommendedQty)} ${first.unit} ${when}${first.lateByDays > 0 ? ` (${first.lateByDays} ${first.lateByDays === 1 ? 'day' : 'days'} late even so)` : ''}.`,
    detail:   toOrder.length > 1 ? `Then ${toOrder.slice(1, 3).map(rec => `${rec.materialName} (${rec.branchName})`).join(', ')}${toOrder.length > 3 ? ' …' : ''}.` : null,
  }
}

/** Feature 5: tomorrow's batches per kitchen. */
async function demandTile(): Promise<KitchenAiTileDto> {
  const tomorrow = addDays(todayIsoDate(), 1)
  const kitchens = await BranchRepository.findActiveKitchens()
  const forecasts = (await Promise.all(kitchens.map(kitchen => DemandForecastService.forecast(kitchen.id, tomorrow))))
    .filter(forecast => forecast !== null)
  const holiday = forecasts.find(forecast => forecast.holiday)?.holiday
  const perKitchen = forecasts.map(forecast => {
    const batches = forecast.goods.reduce((n, good) => n + good.batches, 0)
    return `${forecast.kitchen.name.replace(/ Commissary$/, '')} ${batches}`
  })
  return {
    feature:   5,
    title:     'Demand forecaster',
    headline:  `Tomorrow (${shortDateLabel(tomorrow)}), batches still to plan: ${perKitchen.join(' · ') || 'no kitchen'}.`,
    detail:    holiday ? `🎌 ${holiday.name} — see how past holidays went.` : 'From the requests, or the usual amount for the weekday while they are open.',
    href:      '/production/plan',
    linkLabel: 'Open the plan',
  }
}

/** Feature 3, from the Waste card's own figures. */
function wasteTile(waste: WasteDashboardDto): KitchenAiTileDto {
  const { totals } = waste.facts
  return {
    feature:   3,
    title:     'Waste pattern detector',
    headline:  `${formatPeso(totals.lostValue)} lost in the last 30 days${totals.lostPctOfProductionCost ? ` — ${totals.lostPctOfProductionCost}% of production cost` : ''}.`,
    detail:    waste.report ? `${waste.totalFindings} findings in this week's report.` : 'This week\'s report is not written yet.',
    href:      '#waste',
    linkLabel: 'See the report below',
  }
}

/** Feature 6, from the Suppliers card's own figures. */
function supplierTile(suppliers: SupplierDashboardDto): KitchenAiTileDto {
  const flagged = suppliers.facts.suppliers.filter(row => row.flags.length > 0)
  return {
    feature:   6,
    title:     'Supplier performance',
    headline:  flagged.length === 0
      ? `No supplier flagged in ${monthLabel(suppliers.month)}.`
      : `${flagged.length} of ${suppliers.facts.suppliers.length} suppliers flagged in ${monthLabel(suppliers.month)}: ${flagged.map(row => `${row.supplier} (${row.flags.join(', ')})`).join('; ')}.`,
    detail:    suppliers.report ? 'Reviewed by KitchenAI.' : 'The month\'s review is not written yet.',
    href:      '#suppliers',
    linkLabel: 'See the review below',
  }
}

/**
 * "KitchenAI at a glance": a tile per feature the viewer may use, in the
 * roadmap's order. The waste and supplier figures are the cards' own (passed
 * in, read once for the page).
 */
async function kitchenAi(viewer: Viewer, map: StockMap, cards: { waste: WasteDashboardDto | null; suppliers: SupplierDashboardDto | null }): Promise<KitchenAiTileDto[]> {
  const production = PRODUCTION_ROLES.includes(viewer.role)
  const [costVariance, reorder, demand] = await Promise.all([
    production ? costVarianceTile() : null,
    STOCK_ROLES.includes(viewer.role) ? reorderTile(map) : null,
    production ? demandTile() : null,
  ])
  const tiles: (KitchenAiTileDto | null)[] = [
    costVariance,
    canUseAssistant(viewer.role) ? {
      feature: 2, title: 'Ask KitchenAI',
      headline: 'Questions about stock, costs, orders and deliveries, in English, Filipino or Taglish.',
      detail: 'It can also draft a purchase request or a production order for you to confirm.',
      href: null, linkLabel: null,
    } : null,
    cards.waste ? wasteTile(cards.waste) : null,
    reorder,
    demand,
    cards.suppliers ? supplierTile(cards.suppliers) : null,
    production ? {
      feature: 7, title: 'Decision simulator',
      headline: 'Try a production run against the recipes, stock and prices before planning it.',
      detail: 'Shortages, cost per kg, stock after — and KitchenAI\'s advice.',
      href: '/production/plan#simulate', linkLabel: 'Simulate tomorrow\'s run',
    } : null,
  ]
  return tiles.filter((tile): tile is KitchenAiTileDto => tile !== null)
}

/**
 * Everything the Dashboard shows besides the assistant and the two report
 * cards; the stock map is read once. A branch manager gets none of it: the
 * figures are company-wide, and their own branch is on Branch Inventory (the
 * owner kept company-wide insights from them, 2026-11-21).
 */
async function forViewer(viewer: Viewer, cards: { waste: WasteDashboardDto | null; suppliers: SupplierDashboardDto | null }) {
  if (viewer.role === 'BRANCH_MANAGER') return { stats: [], kitchenAi: [] }
  const map = await InventoryService.stockMap()
  const [statCards, tiles] = await Promise.all([stats(viewer, map), kitchenAi(viewer, map, cards)])
  return { stats: statCards, kitchenAi: tiles }
}

export const DashboardService = {
  forViewer,
}
