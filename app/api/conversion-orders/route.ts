import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ConversionOrderService } from '@/services/conversion-order.service'

const QuantityString = z.string().regex(/^\d+(\.\d+)?$/, 'Must be a positive decimal')

// Shape only. The rules that need the database or Decimal arithmetic (an
// active conversion recipe, enough unexpired source at the branch, quantities
// > 0, output within reason) belong to ConversionOrderService.
const CreateConversionOrderSchema = z.object({
  bomId:     z.string().cuid(),
  branchId:  z.string().cuid(),
  sourceQty: QuantityString,
  outputQty: QuantityString,
  notes:     z.string().trim().max(1000).nullish(),
})

/**
 * Records a conversion and submits it for approval in one step — there is no
 * draft (Week 7 Task 1, D4). ADMIN + PRODUCTION_MANAGER (middleware).
 */
export async function POST(req: NextRequest) {
  try {
    // The submitter is NEVER read from the body — see docs/coding-conventions.md.
    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')

    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = CreateConversionOrderSchema.safeParse(await req.json())

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await ConversionOrderService.create(parsed.data, { userId, role })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ conversionOrder: result.data }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/conversion-orders]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
