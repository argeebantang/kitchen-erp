import { AiInsightType } from '@prisma/client'
import { CostVarianceService } from '@/services/cost-variance.service'
import { WastePatternService } from '@/services/waste-pattern.service'
import { SupplierPerformanceService } from '@/services/supplier-performance.service'
import { REORDER_GENERATE_ROLES, ReorderService } from '@/services/reorder.service'

/**
 * Every stored AI insight type, in one place (Week 10 Task 2, P6): who may see
 * it, who may ask for it or press Regenerate, and how it is asked for. One
 * endpoint (POST /api/ai/insights) and one Regenerate button serve them all;
 * each feature adds its entry here.
 *
 * Asking only marks the insight PENDING and queues its job — nothing is
 * spent in the request, and asking again while one is being written queues
 * nothing.
 */

export type InsightRequestResult =
  | { success: true; data: { queued: boolean } }
  | { success: false; error: string; status: number }

type InsightHandler = {
  /** Roles that may ask for it, or regenerate it. VIEWER never: reading is free, writing costs. */
  generateRoles: string[]
  request(referenceId: string, userId: string, options: { regenerate: boolean }): Promise<InsightRequestResult>
}

const HANDLERS: Partial<Record<AiInsightType, InsightHandler>> = {
  // Feature 1 (Week 9 Task 2): a completed production order's cost explanation.
  [AiInsightType.COST_VARIANCE]: {
    generateRoles: ['ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTING'],
    request: (productionOrderId, userId, options) => CostVarianceService.request(productionOrderId, userId, options),
  },
  // Feature 3 (Week 10 Task 2): the weekly waste pattern report, by ISO week (2026-W48).
  [AiInsightType.WASTE_PATTERN]: {
    generateRoles: ['ADMIN', 'ACCOUNTING', 'PRODUCTION_MANAGER'],
    request: (week, userId, options) => WastePatternService.request(week, userId, options),
  },
  // Feature 6 (Week 10 Task 3): the monthly supplier performance report, by month (2026-10).
  [AiInsightType.SUPPLIER_PERFORMANCE]: {
    generateRoles: ['ADMIN', 'ACCOUNTING', 'PROCUREMENT_MANAGER'],
    request: (month, userId, options) => SupplierPerformanceService.request(month, userId, options),
  },
  // Feature 4 (Week 10 Task 4): one kitchen's reorder of one material, by position ('<branchId>:<materialId>').
  [AiInsightType.REORDER_RECOMMENDATION]: {
    generateRoles: REORDER_GENERATE_ROLES,
    request: (position, userId, options) => ReorderService.request(position, userId, options),
  },
}

export function isInsightType(value: string): value is AiInsightType {
  return Object.prototype.hasOwnProperty.call(HANDLERS, value)
}

export const AiInsightService = {
  /** Whether this role sees the Explain / Try again / Regenerate buttons for this type. */
  canGenerate(type: AiInsightType, role: string): boolean {
    return HANDLERS[type]?.generateRoles.includes(role) ?? false
  },

  async request(
    input: { type: AiInsightType; referenceId: string; regenerate: boolean },
    viewer: { userId: string; role: string },
  ): Promise<InsightRequestResult> {
    const handler = HANDLERS[input.type]
    if (!handler) return { success: false, error: 'Unknown insight', status: 400 }
    if (!handler.generateRoles.includes(viewer.role)) {
      return { success: false, error: 'Your role cannot ask for this AI insight', status: 403 }
    }
    return handler.request(input.referenceId, viewer.userId, { regenerate: input.regenerate })
  },
}
