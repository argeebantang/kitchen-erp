import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { BomKind } from '@prisma/client'
import { BomService } from '@/services/bom.service'

const PositiveDecimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'Must be a non-negative decimal')

const ListQuerySchema = z.object({
  finishedGoodId:    z.string().cuid().optional(),
  kind:              z.nativeEnum(BomKind).optional(),
  // Not z.coerce.boolean(): that is Boolean(value), which reads "false" as true.
  includeSuperseded: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  skip:              z.coerce.number().int().min(0).optional(),
  take:              z.coerce.number().int().min(1).max(100).optional(),
})

const CreateBomSchema = z.object({
  finishedGoodId: z.string().cuid(),
  // Omitted = PRODUCTION. A CONVERSION recipe also names its source finished
  // good and how much of it one batch uses (Week 7 Task 1, D2); the service
  // checks the pairing.
  kind:                 z.nativeEnum(BomKind).optional(),
  sourceFinishedGoodId: z.string().cuid().nullish(),
  sourceQuantity:       PositiveDecimalString.nullish(),
  batchSize:      PositiveDecimalString,
  batchUnitId:    z.string().cuid(),
  notes:          z.string().trim().max(1000).nullish(),
  items: z
    .array(
      z.object({
        materialId: z.string().cuid(),
        quantity:   PositiveDecimalString,
        unitId:     z.string().cuid(),
        notes:      z.string().trim().max(500).nullish(),
      }),
    )
    .min(1, 'A BOM needs at least one ingredient line'),
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

    return NextResponse.json(await BomService.list(parsed.data))
  } catch (err) {
    console.error('[GET /api/boms]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Creates a BOM. This is also the edit endpoint — there is no PATCH, because a
 * BOM version is immutable once it exists. Posting for a finished good that
 * already has a BOM of that kind supersedes its active version with version + 1.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = CreateBomSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await BomService.createVersion(parsed.data)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ bom: result.data }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/boms]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
