import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ItemPriceService } from '@/services/item-price.service'

const RecordPriceSchema = z.object({
  unitPrice:     z.string().regex(/^\d+(\.\d+)?$/, 'Must be a non-negative decimal'),
  // Back-dating is allowed on purpose — invoices arrive after the fact.
  effectiveDate: z.string().datetime({ offset: true }).or(z.string().date()),
  supplierId:    z.string().cuid().nullish(),
  note:          z.string().trim().max(500).nullish(),
})

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const result = await ItemPriceService.history(id)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ prices: result.data })
  } catch (err) {
    console.error('[GET /api/materials/[id]/prices]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const body = await req.json()
    const parsed = RecordPriceSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await ItemPriceService.record({ materialId: id, ...parsed.data })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ price: result.data }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/materials/[id]/prices]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
