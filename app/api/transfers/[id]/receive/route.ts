import { NextRequest, NextResponse } from 'next/server'
import { StockTransferService } from '@/services/stock-transfer.service'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * The receiving branch confirms a transfer arrived (Week 8 Task 3, R3):
 * everything dispatched joins its stock. The receiving branch's manager or an
 * ADMIN — checked in the service, since the role alone does not say which
 * branch someone manages.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')
    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const result = await StockTransferService.receive(id, { userId, role })
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ transfer: result.data })
  } catch (err) {
    console.error('[POST /api/transfers/[id]/receive]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
