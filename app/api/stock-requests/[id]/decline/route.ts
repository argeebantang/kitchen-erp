import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { StockRequestService, REQUEST_NOTE_MAX } from '@/services/stock-request.service'

type RouteContext = { params: Promise<{ id: string }> }

const DeclineSchema = z.object({
  reason: z.string().trim().min(1, 'Give a reason').max(REQUEST_NOTE_MAX),
})

/** The kitchen will not send it — with the reason the outlet sees (Week 9 Task 10). */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')
    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const parsed = DeclineSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', fields: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const result = await StockRequestService.decline(id, { userId, role }, parsed.data.reason)
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ stockRequest: result.data })
  } catch (err) {
    console.error('[POST /api/stock-requests/[id]/decline]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
