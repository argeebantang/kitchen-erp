import { NextRequest, NextResponse } from 'next/server'
import { PurchaseOrderService } from '@/services/purchase-order.service'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params

    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')

    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await PurchaseOrderService.submit(id, { userId, role })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ purchaseOrder: result.data })
  } catch (err) {
    console.error('[POST /api/purchase-orders/[id]/submit]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
