import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { MAX_BATCH_COUNT, ProductionOrderService } from '@/services/production-order.service'

type RouteContext = {
  params: Promise<{ id: string }>
}

// The same fields as create: an edit may change the finished good too, and
// the service re-pins the BOM either way.
const UpdateSchema = z.object({
  finishedGoodId: z.string().cuid(),
  batchWeight:    z.string().regex(/^\d+(\.\d+)?$/, 'Must be a positive decimal'),
  batchCount:     z.number().int().min(1).max(MAX_BATCH_COUNT),
  plannedDate:    z.string().date(),
  branchId:       z.string().cuid(),
  notes:          z.string().trim().max(1000).nullish(),
})

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params

    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')

    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = UpdateSchema.safeParse(await req.json())

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await ProductionOrderService.update(id, parsed.data, { userId, role })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ productionOrder: result.data })
  } catch (err) {
    console.error('[PATCH /api/production-orders/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
