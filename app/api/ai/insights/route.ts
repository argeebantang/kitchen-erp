import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AiInsightService, isInsightType } from '@/services/ai-insight.service'

const InsightRequestSchema = z.object({
  type:        z.string().refine(isInsightType, 'Unknown insight type'),
  // A record id, or a period key such as 2026-W48 — each type checks its own.
  referenceId: z.string().trim().min(1).max(64),
  regenerate:  z.boolean().optional(),
})

/**
 * Ask for an AI insight, or regenerate one (Week 10 Task 2): "Explain this
 * batch", "Try again", "Regenerate" for every insight type. The guard admits
 * the roles that can ask for any type; AiInsightService checks the type's own.
 * Only queues the job — the page shows it being written and refreshes.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')
    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const parsed = InsightRequestSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success || !isInsightType(parsed.data.type)) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.success ? {} : parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const result = await AiInsightService.request(
      { type: parsed.data.type, referenceId: parsed.data.referenceId, regenerate: parsed.data.regenerate ?? false },
      { userId, role },
    )
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (err) {
    console.error('[POST /api/ai/insights]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
