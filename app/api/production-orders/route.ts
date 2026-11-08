import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { MAX_BATCH_COUNT, ProductionOrderService } from '@/services/production-order.service'

// Shape only. The rules that need the database or Decimal arithmetic (active
// BOM, matching units, weight > 0, date not in the past) belong to
// ProductionOrderService.
const CreateProductionOrderSchema = z.object({
  finishedGoodId: z.string().cuid(),
  batchWeight:    z.string().regex(/^\d+(\.\d+)?$/, 'Must be a positive decimal'),
  // A count, not a quantity, so a JSON number rather than a decimal string.
  batchCount:     z.number().int().min(1).max(MAX_BATCH_COUNT),
  plannedDate:    z.string().date(),
  branchId:       z.string().cuid(),
  notes:          z.string().trim().max(1000).nullish(),
})

export async function POST(req: NextRequest) {

  try {
    // The requester is NEVER read from the body — see docs/coding-conventions.md.
    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')

    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = CreateProductionOrderSchema.safeParse(await req.json())

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await ProductionOrderService.create(parsed.data, { userId, role })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ productionOrder: result.data }, { status: 201 })

  } catch (err) {
    console.error('[POST /api/production-orders]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
