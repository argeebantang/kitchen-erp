import { NextRequest, NextResponse } from 'next/server'
import { BomService } from '@/services/bom.service'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Version history for a finished good's BOM — every version ever created,
 * newest first, including superseded ones. Nothing is deleted, so this is the
 * full audit trail of how a recipe changed over time.
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const result = await BomService.versions(id)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ versions: result.data })
  } catch (err) {
    console.error('[GET /api/finished-goods/[id]/bom-versions]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
