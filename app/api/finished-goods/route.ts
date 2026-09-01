import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { FinishedGoodService } from '@/services/finished-good.service'

const DecimalString = z.string().regex(/^\d+(\.\d+)?$/, 'Must be a non-negative decimal')

const ListQuerySchema = z.object({
  search:          z.string().trim().min(1).optional(),
  categoryId:      z.string().cuid().optional(),
  includeInactive: z.coerce.boolean().optional(),
  skip:            z.coerce.number().int().min(0).optional(),
  take:            z.coerce.number().int().min(1).max(100).optional(),
})

const CreateFinishedGoodSchema = z.object({
  code:         z.string().trim().min(1).max(50),
  name:         z.string().trim().min(2).max(200),
  description:  z.string().trim().max(1000).nullish(),
  categoryId:   z.string().cuid(),
  unitId:       z.string().cuid(),
  sellingPrice: DecimalString,
})

export async function GET(req: NextRequest) {
  try {
    const parsed = ListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams))

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    return NextResponse.json(await FinishedGoodService.list(parsed.data))
  } catch (err) {
    console.error('[GET /api/finished-goods]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = CreateFinishedGoodSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await FinishedGoodService.create(parsed.data)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ finishedGood: result.data }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/finished-goods]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
