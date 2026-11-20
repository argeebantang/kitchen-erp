import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AssistantActionService } from '@/services/assistant-action.service'

type RouteContext = {
  params: Promise<{ id: string }>
}

const DecideSchema = z.object({
  decision: z.enum(['confirm', 'cancel']),
})

/**
 * Confirm or Cancel a draft the assistant prepared (Week 9 Task 5, I1). The
 * id is the question's; the draft itself is read from the server, never from
 * the body (I2). The /api/ai/assistant guard admits the assistant's roles;
 * the service narrows to the roles that may draft (I5).
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')
    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = DecideSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await AssistantActionService.decide(id, parsed.data.decision, { userId, role })
    if (!result.success) {
      // The draft as it now stands, so the card can show it confirmed, cancelled or expired.
      return NextResponse.json({ error: result.error, action: result.action }, { status: result.status })
    }
    return NextResponse.json({ action: result.data })
  } catch (err) {
    console.error('[POST /api/ai/assistant/actions/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
