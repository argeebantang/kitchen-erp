import { NextRequest, NextResponse } from 'next/server'
import { TransferVarianceReason } from '@prisma/client'
import { z } from 'zod'
import { StockTransferService, MAX_TRANSFER_LINES } from '@/services/stock-transfer.service'

type RouteContext = { params: Promise<{ id: string }> }

// Shape only. Matching the counts to the lots that were sent, received ≤
// sent and when a reason is needed are StockTransferService's (Decimal and
// the dispatch rows). A line can take several lots, hence the generous cap.
const ReceiveTransferSchema = z.object({
  lots: z.array(z.object({
    lotId:    z.string().cuid(),
    received: z.string().trim().regex(/^\d+(\.\d+)?$/, 'Must be 0 or a positive decimal'),
  })).min(1, 'Count at least one lot').max(MAX_TRANSFER_LINES * 10),
  reason: z.nativeEnum(TransferVarianceReason).nullish(),
  notes:  z.string().trim().max(1000).nullish(),
})

/**
 * The receiving branch confirms what arrived (Week 8 Task 3, R3; Task 4):
 * a count per dispatched lot — what arrived joins its stock, anything short
 * is recorded as lost in transit with a reason. The receiving branch's
 * manager or an ADMIN — checked in the service, since the role alone does
 * not say which branch someone manages.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')
    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = ReceiveTransferSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { id } = await params
    const result = await StockTransferService.receive(id, { userId, role }, {
      lots:   parsed.data.lots,
      reason: parsed.data.reason ?? null,
      notes:  parsed.data.notes ?? null,
    })
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ transfer: result.data })
  } catch (err) {
    console.error('[POST /api/transfers/[id]/receive]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
