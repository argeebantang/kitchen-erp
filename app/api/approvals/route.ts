import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PurchaseRequestService } from '@/services/purchase-request.service'


/**
 * One endpoint for every approval decision in the system.
 *
 * referenceType is a literal rather than a free string: today only purchase
 * requests can be approved, so anything else gets a clean 400 here instead of
 * failing confusingly deeper down. When purchase orders need approval this
 * becomes z.enum(['PurchaseRequest', 'PurchaseOrder']) — no new route, and no
 * new middleware guard, because /api/approvals is already ACCOUNTING-only.
 */
const DecisionSchema = z.object({
  referenceType: z.literal('PurchaseRequest'),
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

        // referenceType is a literal today, so there is nothing to dispatch on yet.
    // When purchase orders join, this becomes a switch and the schema widens.
    const result = await PurchaseRequestService.applyDecision(
      parsed.data.referenceId,
      { userId, role },
      parsed.data.decision,
      parsed.data.remarks ?? null,
    )

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ purchaseRequest: result.data })

  } catch (err) {
    console.error('[POST /api/approvals]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
