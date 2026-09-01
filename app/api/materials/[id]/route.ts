import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { MaterialService } from '@/services/material.service'

const DecimalString = z.string().regex(/^\d+(\.\d+)?$/, 'Must be a non-negative decimal')

const UpdateMaterialSchema = z.object({
  name:         z.string().trim().min(2).max(200).optional(),
  description:  z.string().trim().max(1000).nullish(),
  categoryId:   z.string().cuid().optional(),
  unitId:       z.string().cuid().optional(),
  reorderPoint: DecimalString.optional(),
  isActive:     z.boolean().optional(),
})

// Next.js 15: route params are a Promise and must be awaited. Destructuring
// them the Next 14 way yields undefined rather than a type error.
type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const result = await MaterialService.getById(id)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ material: result.data })
  } catch (err) {
    console.error('[GET /api/materials/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const body = await req.json()
    const parsed = UpdateMaterialSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await MaterialService.update(id, parsed.data)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ material: result.data })
  } catch (err) {
    console.error('[PATCH /api/materials/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Deactivates rather than deletes — BOM lines, purchase orders and stock
 * movements reference materials, so a hard delete would orphan history.
 */
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const result = await MaterialService.deactivate(id)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ material: result.data })
  } catch (err) {
    console.error('[DELETE /api/materials/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
