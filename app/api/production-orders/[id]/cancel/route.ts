import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ProductionOrderService } from '@/services/production-order.service'

type RouteContext = {
  params: Promise<{ id: string }>
}

// The reason goes on the status log, the audit trail of why a run was called off.
const CancelSchema = z.object({
  reason: z.string().trim().min(1, 'Give a reason for cancelling').max(500),
})

/** DRAFT | PENDING_APPROVAL | APPROVED → CANCELLED. */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params

    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')

    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = CancelSchema.safeParse(await req.json().catch(() => null))

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await ProductionOrderService.cancel(id, { userId, role }, parsed.data.reason)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ productionOrder: result.data })
  } catch (err) {
    console.error('[POST /api/production-orders/[id]/cancel]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
