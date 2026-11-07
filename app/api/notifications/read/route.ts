import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { NotificationService } from '@/services/notification.service'

const MarkReadSchema = z.union([
  z.object({ id: z.string().cuid() }),
  z.object({ all: z.literal(true) }),
])

/**
 * Mark one notification read ({ id }) or all of them ({ all: true }) for the
 * signed-in user. Every role may call it; the user comes from the middleware
 * header, so only their own rows can change.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = MarkReadSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        // A union fails as a whole, so fieldErrors is empty: say what to send.
        { error: 'Send { "id": "<notification id>" } or { "all": true }', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const updated = await NotificationService.markRead(userId, parsed.data)
    return NextResponse.json({ updated })
  } catch (err) {
    console.error('[POST /api/notifications/read]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
