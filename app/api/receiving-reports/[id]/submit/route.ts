import { NextRequest, NextResponse } from 'next/server'
import { ReceivingReportService } from '@/services/receiving-report.service'

type RouteContext = {
  params: Promise<{ id: string }>
}

// One endpoint per transition, like purchase orders. Covered by the
// /api/receiving-reports guard in middleware.ts (ADMIN, PROCUREMENT_MANAGER).
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params

    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')

    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await ReceivingReportService.submit(id, { userId, role })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ receivingReport: result.data })
  } catch (err) {
    console.error('[POST /api/receiving-reports/[id]/submit]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
