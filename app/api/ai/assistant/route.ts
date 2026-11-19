import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  ASSISTANT_HISTORY,
  ASSISTANT_MESSAGE_MAX,
  ASSISTANT_QUESTION_MAX,
  AssistantService,
} from '@/services/assistant.service'

const MessageSchema = z.object({
  role:    z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(ASSISTANT_MESSAGE_MAX),
})

// The page sends the conversation so far; the last message is the question.
const AskSchema = z.object({
  messages: z.array(MessageSchema).min(1).max(ASSISTANT_HISTORY + 1),
}).superRefine(({ messages }, ctx) => {
  // Zod still runs this when .min(1) has failed, so an empty list reaches here.
  const question = messages.at(-1)
  if (!question) return
  if (question.role !== 'user') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['messages'], message: 'The last message must be the question' })
  } else if (question.content.length > ASSISTANT_QUESTION_MAX) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['messages'], message: `Keep the question under ${ASSISTANT_QUESTION_MAX} characters` })
  }
})

/**
 * The dashboard assistant (Week 9 Task 3, F5). ADMIN, ACCOUNTING and
 * PRODUCTION_MANAGER (middleware). Each round of a question is a real Claude
 * call, recorded and counted toward the monthly budget.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')
    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = AskSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await AssistantService.ask(parsed.data.messages, { userId, role })
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (err) {
    console.error('[POST /api/ai/assistant]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
