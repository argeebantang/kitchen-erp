import { NextRequest, NextResponse } from 'next/server'
import { EmailService } from '@/services/email.service'

/**
 * Admin → Email's "Send a test email" (Week 11 Task 2): one real email to the
 * admin's own notification address, sent now and logged. ADMIN only (middleware).
 */
export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await EmailService.sendTest(userId)
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ sentTo: result.data.to })
  } catch (err) {
    console.error('[POST /api/email/test]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
