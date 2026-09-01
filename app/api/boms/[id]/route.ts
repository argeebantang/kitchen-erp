import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { BomService } from '@/services/bom.service'

const TargetQuantitySchema = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'Must be a non-negative decimal')

type RouteContext = { params: Promise<{ id: string }> }

/**
 * `?targetQuantity=25` returns the same BOM with every line scaled to a 25-unit
 * output. Omitted, lines come back as authored.
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const targetParam = req.nextUrl.searchParams.get('targetQuantity')

    let targetQuantity: string | undefined
    if (targetParam !== null) {
      const parsed = TargetQuantitySchema.safeParse(targetParam)
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid target quantity' }, { status: 400 })
      }
      targetQuantity = parsed.data
    }

    const result = await BomService.getById(id, targetQuantity)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ bom: result.data })
  } catch (err) {
    console.error('[GET /api/boms/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
