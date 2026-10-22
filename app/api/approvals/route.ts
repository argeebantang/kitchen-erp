import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PurchaseRequestService } from '@/services/purchase-request.service'
import { PurchaseOrderService } from '@/services/purchase-order.service'


const DecisionSchema = z.object({
  referenceType: z.enum(['PurchaseRequest', 'PurchaseOrder']),
  referenceId:   z.string().cuid(),
  decision:      z.enum(['APPROVED', 'REJECTED']),
  remarks:       z.string().trim().max(1000).nullish(),
})

export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')

    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = DecisionSchema.safeParse(await req.json())

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { referenceType, referenceId, decision } = parsed.data
    const remarks = parsed.data.remarks ?? null
    const viewer  = { userId, role }

    if (referenceType === 'PurchaseOrder') {
      const result = await PurchaseOrderService.applyDecision(referenceId, viewer, decision, remarks)

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }

      return NextResponse.json({ purchaseOrder: result.data })
    }

    const result = await PurchaseRequestService.applyDecision(referenceId, viewer, decision, remarks)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ purchaseRequest: result.data })

  } catch (err) {
    console.error('[POST /api/approvals]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
