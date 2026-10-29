import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { PurchaseOrderDocument } from '@/components/pdf/PurchaseOrderDocument'
import { PurchaseOrderService } from '@/services/purchase-order.service'

// react-pdf needs Node (fonts, streams). Stated explicitly so a future change
// to the default runtime cannot move it onto the Edge, where it would fail.
export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{ id: string }>
}

// Data comes from the service, which refuses anything not yet approved.
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params

    const userId = req.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await PurchaseOrderService.getForPdf(id)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    const po = result.data
    const buffer = await renderToBuffer(<PurchaseOrderDocument po={po} />)

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `inline; filename="${po.poNumber}.pdf"`,
      },
    })
  } catch (err) {
    console.error('[GET /api/purchase-orders/[id]/pdf]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
