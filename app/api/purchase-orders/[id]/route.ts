import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PurchaseOrderService } from '@/services/purchase-order.service'

type RouteContext = {
  params: Promise<{ id: string }>
}

const UpdateSchema = z.object({
  supplierId:       z.string().cuid().nullish(),
  expectedDelivery: z.string().date().nullish(),
  notes:            z.string().trim().max(1000).nullish(),
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

    const result = await PurchaseOrderService.updateDraft(id, parsed.data, { role })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ purchaseOrder: result.data })
  } catch (err) {
    console.error('[PATCH /api/purchase-orders/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
