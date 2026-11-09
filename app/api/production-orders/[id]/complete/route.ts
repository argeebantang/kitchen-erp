import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ProductionOrderService } from '@/services/production-order.service'

type RouteContext = {
  params: Promise<{ id: string }>
}

// A decimal string like every quantity in the API; the service checks > 0
// and the upper bound against the order's planned output.
const CompleteSchema = z.object({
  actualQty: z.string().regex(/^\d+(\.\d+)?$/, 'Must be a positive decimal'),
})

/** IN_PROGRESS → PENDING_COMPLETION, with the actual yield. Who reported it comes from the headers. */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params

    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')

    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = CompleteSchema.safeParse(await req.json().catch(() => null))

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await ProductionOrderService.complete(id, { userId, role }, parsed.data.actualQty)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ productionOrder: result.data })
  } catch (err) {
    console.error('[POST /api/production-orders/[id]/complete]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
