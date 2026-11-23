import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { EmailService } from '@/services/email.service'

const RecipientSchema = z.object({
  // Empty clears it: that user gets in-app notifications only.
  notificationEmail: z.union([
    z.literal('').transform(() => null),
    z.null(),
    z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
  ]),
})

type RouteContext = { params: Promise<{ userId: string }> }

/**
 * Where a user's emails go (Week 11 Task 2) — set by an admin on Admin → Email.
 * ADMIN only (middleware). Never the login email: that stays as it is.
 */
export async function PUT(req: NextRequest, { params }: RouteContext) {
  try {
    if (!req.headers.get('x-user-id')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { userId } = await params

    const parsed = RecipientSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await EmailService.setNotificationEmail(userId, parsed.data.notificationEmail)
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (err) {
    console.error('[PUT /api/email/recipients/[userId]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
