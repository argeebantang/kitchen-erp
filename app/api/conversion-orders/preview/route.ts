import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ConversionOrderService } from '@/services/conversion-order.service'

const QuantityString = z.string().regex(/^\d+(\.\d+)?$/, 'Must be a positive decimal')

const PreviewQuerySchema = z.object({
  bomId:     z.string().cuid(),
  // Where it was done: the source lots and ingredient stock are this branch's.
  branchId:  z.string().cuid(),
  // Optional, so the form can show what is on hand before anything is typed.
  sourceQty: QuantityString.optional(),
  outputQty: QuantityString.optional(),
})

/**
 * The conversion form's live preview: source lots, added ingredients and the
 * output lot. Read-only; same guard as the rest of /api/conversion-orders.
 */
export async function GET(req: NextRequest) {
  try {
    const parsed = PreviewQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams))

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await ConversionOrderService.preview(parsed.data)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ preview: result.data })
  } catch (err) {
    console.error('[GET /api/conversion-orders/preview]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
