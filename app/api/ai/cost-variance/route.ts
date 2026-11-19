import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { CostVarianceService } from '@/services/cost-variance.service'

const ExplainSchema = z.object({
  productionOrderId: z.string().cuid(),
})

/**
 * "Explain this batch" / "Try again" on a completed production order (Week 9
 * Task 2, E6). ADMIN, PRODUCTION_MANAGER and ACCOUNTING (middleware) — the
 * roles that read production orders. Only queues the job: the worker writes
 * the explanation, and the page polls while it is pending. Asking again while
 * one is pending or written queues nothing, so it cannot pay twice.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = ExplainSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await CostVarianceService.request(parsed.data.productionOrderId, userId)
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (err) {
    console.error('[POST /api/ai/cost-variance]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
