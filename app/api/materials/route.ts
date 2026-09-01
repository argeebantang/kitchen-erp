import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { MaterialService } from '@/services/material.service'

// Decimals arrive as strings, never numbers — a JS number cannot round-trip the
// precision the column holds. See lib/decimal.ts.
const DecimalString = z.string().regex(/^\d+(\.\d+)?$/, 'Must be a non-negative decimal')

const ListQuerySchema = z.object({
  search:          z.string().trim().min(1).optional(),
  categoryId:      z.string().cuid().optional(),
  includeInactive: z.coerce.boolean().optional(),
  skip:            z.coerce.number().int().min(0).optional(),
  take:            z.coerce.number().int().min(1).max(100).optional(),
})

const CreateMaterialSchema = z.object({
  code:         z.string().trim().min(1).max(50),
  name:         z.string().trim().min(2).max(200),
  description:  z.string().trim().max(1000).nullish(),
  categoryId:   z.string().cuid(),
  unitId:       z.string().cuid(),
  reorderPoint: DecimalString,
})

export async function GET(req: NextRequest) {
  try {
    const parsed = ListQuerySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams),
    )

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await MaterialService.list(parsed.data)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[GET /api/materials]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = CreateMaterialSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await MaterialService.create(parsed.data)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ material: result.data }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/materials]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
