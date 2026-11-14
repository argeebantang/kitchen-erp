import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { StockTransferService, MAX_TRANSFER_LINES } from '@/services/stock-transfer.service'

const QuantityString = z.string().trim().regex(/^\d+(\.\d+)?$/, 'Must be a positive decimal')

// Shape only. Rules needing the database or Decimal arithmetic (an active
// commissary sending, an active receiver, one line per active good, > 0,
// within what the sender can send) belong to StockTransferService.
const CreateStockTransferSchema = z.object({
  fromBranchId: z.string().cuid(),
  toBranchId:   z.string().cuid(),
  notes:        z.string().trim().max(1000).nullish(),
  lines: z.array(z.object({
    finishedGoodId: z.string().cuid(),
    quantity:       QuantityString,
  })).min(1, 'Add at least one finished good').max(MAX_TRANSFER_LINES),
})

/**
 * Records a transfer and submits it for approval in one step — there is no
 * draft (Week 8 Task 2, T6). ADMIN + PRODUCTION_MANAGER (middleware).
 */
export async function POST(req: NextRequest) {
  try {
    // The submitter is NEVER read from the body — see docs/coding-conventions.md.
    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')
    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = CreateStockTransferSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await StockTransferService.create(parsed.data, { userId, role })
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ transfer: result.data }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/transfers]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
