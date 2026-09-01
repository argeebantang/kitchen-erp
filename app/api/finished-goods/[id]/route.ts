import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { FinishedGoodService } from '@/services/finished-good.service'

const DecimalString = z.string().regex(/^\d+(\.\d+)?$/, 'Must be a non-negative decimal')

const UpdateFinishedGoodSchema = z.object({
  name:         z.string().trim().min(2).max(200).optional(),
  description:  z.string().trim().max(1000).nullish(),
  categoryId:   z.string().cuid().optional(),
  unitId:       z.string().cuid().optional(),
  sellingPrice: DecimalString.optional(),
  isActive:     z.boolean().optional(),
})

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const result = await FinishedGoodService.getById(id)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ finishedGood: result.data })
  } catch (err) {
    console.error('[GET /api/finished-goods/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const body = await req.json()
    const parsed = UpdateFinishedGoodSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await FinishedGoodService.update(id, parsed.data)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ finishedGood: result.data })
  } catch (err) {
    console.error('[PATCH /api/finished-goods/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const result = await FinishedGoodService.deactivate(id)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ finishedGood: result.data })
  } catch (err) {
    console.error('[DELETE /api/finished-goods/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
