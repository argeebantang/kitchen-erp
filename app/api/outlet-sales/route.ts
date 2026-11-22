import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { OutletSaleService, MAX_SALE_LINES, SALE_NOTE_MAX } from '@/services/outlet-sale.service'

const QuantityString = z.string().trim().regex(/^\d+(\.\d+)?$/, 'Must be a positive decimal')

// Shape only. The outlet being the viewer's own, the day being today or
// yesterday, one line per active good and enough on the books belong to
// OutletSaleService.
const CreateOutletSaleSchema = z.object({
  branchId: z.string().cuid(),
  soldOn:   z.string().date(),
  notes:    z.string().trim().max(SALE_NOTE_MAX).nullish(),
  lines: z.array(z.object({
    finishedGoodId: z.string().cuid(),
    quantity:       QuantityString,
  })).min(1, 'Enter at least one finished good sold').max(MAX_SALE_LINES),
})

/**
 * Records an outlet's sales for a day (Week 10 Task 1). ADMIN +
 * BRANCH_MANAGER (middleware), the outlet checked in the service. No
 * approval: the goods leave the outlet's stock now.
 */
export async function POST(req: NextRequest) {
  try {
    // The submitter is NEVER read from the body — see docs/coding-conventions.md.
    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')
    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const parsed = CreateOutletSaleSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', fields: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const result = await OutletSaleService.create(parsed.data, { userId, role })
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ sale: result.data }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/outlet-sales]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
