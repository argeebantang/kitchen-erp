import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ReportService } from '@/services/report.service'

const EmailSchema = z.object({
  recipients: z.enum(['me', 'management']),
  // The same query as the page and GET /api/reports/[key].
  preset: z.string().max(20).optional(),
  from:   z.string().max(10).optional(),
  to:     z.string().max(10).optional(),
  date:   z.string().max(10).optional(),
  branch: z.string().cuid().optional(),
})

type RouteContext = { params: Promise<{ key: string }> }

/**
 * "Email this report" (Week 11 Task 7): queue the report's PDF to the caller,
 * or (ADMIN / ACCOUNTING) to management. 202 — the email worker sends it;
 * Admin → Email shows each send. Report roles are checked in ReportService.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')
    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = EmailSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', fields: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const { recipients, preset, from, to, date, branch } = parsed.data
    const { key } = await params

    const result = await ReportService.email(key, { preset, from, to, date, branchId: branch }, recipients, { userId, role })
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data, { status: 202 })
  } catch (err) {
    console.error('[POST /api/reports/[key]/email]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
