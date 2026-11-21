import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { StockRequestService, MAX_REQUEST_LINES, REQUEST_NOTE_MAX } from '@/services/stock-request.service'

type RouteContext = { params: Promise<{ id: string }> }

const PlanSchema = z.object({
  lines: z.array(z.object({
    itemId:          z.string().cuid(),
    plannedQuantity: z.string().trim().regex(/^\d+(\.\d+)?$/, 'Must be a decimal, 0 or more'),
  })).min(1).max(MAX_REQUEST_LINES),
  note: z.string().trim().max(REQUEST_NOTE_MAX).nullish(),
})

/** The kitchen will send it: each line's planned quantity, a note when less than asked (Week 9 Task 10). */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')
    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const parsed = PlanSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', fields: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const result = await StockRequestService.plan(id, { userId, role }, parsed.data)
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ stockRequest: result.data })
  } catch (err) {
    console.error('[POST /api/stock-requests/[id]/plan]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
