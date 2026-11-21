import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { StockTransferService, MAX_TRANSFER_LINES } from '@/services/stock-transfer.service'

const QuantityString = z.string().trim().regex(/^\d+(\.\d+)?$/, 'Must be a positive decimal')

// Shape only. The outlet being the viewer's own, an active kitchen receiving,
// one line per active good and enough on hand belong to StockTransferService.
const CreateReturnSchema = z.object({
  fromBranchId: z.string().cuid(),
  toBranchId:   z.string().cuid(),
  notes:        z.string().trim().max(1000).nullish(),
  lines: z.array(z.object({
    finishedGoodId: z.string().cuid(),
    quantity:       QuantityString,
  })).min(1, 'Add at least one finished good').max(MAX_TRANSFER_LINES),
})

/** Who records returns: an outlet's manager, or an admin (Week 9 Task 9). */
const RETURN_ROLES = ['ADMIN', 'BRANCH_MANAGER']

/**
 * Records a return — unsold goods from an outlet back to a kitchen — and
 * sends it: no approval, the lots leave the outlet now (Week 9 Task 9). The
 * /api/transfers guard admits BRANCH_MANAGER; the role is narrowed here and
 * the outlet checked in the service.
 */
export async function POST(req: NextRequest) {
  try {
    // The submitter is NEVER read from the body — see docs/coding-conventions.md.
    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')
    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!RETURN_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Only an outlet\'s manager, or an admin, records a return' }, { status: 403 })
    }

    const parsed = CreateReturnSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await StockTransferService.createReturn(parsed.data, { userId, role })
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ transfer: result.data }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/transfers/returns]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
