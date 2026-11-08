import { NextRequest, NextResponse } from 'next/server'
import { ProductionOrderService } from '@/services/production-order.service'

type RouteContext = {
  params: Promise<{ id: string }>
}

/** APPROVED → IN_PROGRESS. No body; who started it comes from the headers. */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params

    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')

    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await ProductionOrderService.start(id, { userId, role })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ productionOrder: result.data })
  } catch (err) {
    console.error('[POST /api/production-orders/[id]/start]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
