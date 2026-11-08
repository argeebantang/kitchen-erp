import { NextRequest, NextResponse } from 'next/server'
import { ProductionOrderService } from '@/services/production-order.service'

type RouteContext = {
  params: Promise<{ id: string }>
}

/** DRAFT → PENDING_APPROVAL. No body: what is submitted is the saved draft. */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params

    // The submitter is NEVER read from the body — it is who accounting must
    // not be when deciding (docs/coding-conventions.md).
    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')

    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await ProductionOrderService.submit(id, { userId, role })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ productionOrder: result.data })
  } catch (err) {
    console.error('[POST /api/production-orders/[id]/submit]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
