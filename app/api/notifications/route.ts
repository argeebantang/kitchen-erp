import { NextRequest, NextResponse } from 'next/server'
import { NotificationService } from '@/services/notification.service'

/**
 * The signed-in user's latest notifications and unread count, for the bell.
 * Every role may call it; the user comes from the middleware header, never
 * from the request, so nobody can read someone else's notifications.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = req.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return NextResponse.json(await NotificationService.listForUser(userId))
  } catch (err) {
    console.error('[GET /api/notifications]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
