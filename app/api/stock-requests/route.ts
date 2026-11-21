import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { StockRequestService, MAX_REQUEST_LINES, REQUEST_NOTE_MAX } from '@/services/stock-request.service'

const QuantityString = z.string().trim().regex(/^\d+(\.\d+)?$/, 'Must be a positive decimal')

// Shape only. The outlet being the viewer's own, an active kitchen, a date not
// in the past and one line per active good belong to StockRequestService.
const CreateStockRequestSchema = z.object({
  branchId:  z.string().cuid(),
  kitchenId: z.string().cuid(),
  neededOn:  z.string().date(),
  notes:     z.string().trim().max(REQUEST_NOTE_MAX).nullish(),
  lines: z.array(z.object({
    finishedGoodId: z.string().cuid(),
    quantity:       QuantityString,
  })).min(1, 'Add at least one finished good').max(MAX_REQUEST_LINES),
})

/**
 * An outlet asks a kitchen for finished goods by a date (Week 9 Task 10).
 * ADMIN + BRANCH_MANAGER, checked in the service (the /api/stock-requests
 * guard also admits the kitchen, which plans and declines).
 */
export async function POST(req: NextRequest) {
  try {
    // The submitter is NEVER read from the body — see docs/coding-conventions.md.
    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')
    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const parsed = CreateStockRequestSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', fields: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const result = await StockRequestService.create(parsed.data, { userId, role })
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ stockRequest: result.data }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/stock-requests]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
