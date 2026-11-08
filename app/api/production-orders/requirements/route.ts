import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { MAX_BATCH_COUNT, ProductionOrderService } from '@/services/production-order.service'

// Query strings are always strings, so the count is coerced; the weight stays
// a decimal string, as in the POST body.
const PreviewQuerySchema = z.object({
  finishedGoodId: z.string().cuid(),
  batchWeight:    z.string().regex(/^\d+(\.\d+)?$/, 'Must be a positive decimal'),
  batchCount:     z.coerce.number().int().min(1).max(MAX_BATCH_COUNT),
})

/**
 * The production order form's live "Materials required" preview. A static
 * segment, so Next.js matches it ahead of [id]. Same guard as the rest of
 * /api/production-orders.
 */
export async function GET(req: NextRequest) {
  try {
    const parsed = PreviewQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams))

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await ProductionOrderService.previewRequirements(parsed.data)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ requirements: result.data })
  } catch (err) {
    console.error('[GET /api/production-orders/requirements]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
