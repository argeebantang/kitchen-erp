import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { TransferLabelDocument } from '@/components/pdf/TransferLabelDocument'
import { StockTransferService } from '@/services/stock-transfer.service'
import { absoluteUrl } from '@/lib/app-url'
import { qrPngDataUrl } from '@/lib/qr'

// react-pdf and qrcode need Node — see the purchase order PDF route.
export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{ id: string }>
}

/**
 * The box label for a transfer in transit (Week 12), as a PDF. Who may see
 * the transfer may print it — the service scopes a branch manager to their
 * branch and refuses anything not in transit. The QR holds the transfer's
 * page as a full link: the in-app scanner reads it, and any phone camera
 * opens it too.
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params

    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')
    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await StockTransferService.getForLabel(id, { userId, role })
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    const transfer  = result.data
    const qrDataUrl = await qrPngDataUrl(absoluteUrl(`/inventory/transfers/${transfer.id}`))
    const buffer    = await renderToBuffer(<TransferLabelDocument transfer={transfer} qrDataUrl={qrDataUrl} />)

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `inline; filename="${transfer.transferNumber}-label.pdf"`,
      },
    })
  } catch (err) {
    console.error('[GET /api/transfers/[id]/label]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
