import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AiService, TEST_MESSAGE_MAX } from '@/services/ai.service'

const TestConnectionSchema = z.object({
  message: z.string().trim().min(1, 'Type a message').max(TEST_MESSAGE_MAX),
})

/**
 * One real Claude call from AI Settings (Week 9 Task 1, D10). ADMIN only
 * (middleware). Spends real money — a fraction of a cent — and counts toward
 * the monthly budget like any feature.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = TestConnectionSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await AiService.testConnection(parsed.data.message, userId)
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ completion: result.data })
  } catch (err) {
    console.error('[POST /api/ai/test]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
