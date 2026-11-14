import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { StockTransferService, MAX_TRANSFER_LINES } from '@/services/stock-transfer.service'

// Each line is "<finishedGoodId>" or "<finishedGoodId>:<quantity>" — the
// quantity is left off until it parses, so the stock shows before anything
// is typed.
const LineParam = z.string().regex(/^[a-z0-9]+(:\d+(\.\d+)?)?$/, 'Expected <finishedGoodId>[:<quantity>]')
  .transform(value => {
    const [finishedGoodId, quantity] = value.split(':')
    return { finishedGoodId, quantity: quantity ?? null }
  })
  .pipe(z.object({ finishedGoodId: z.string().cuid(), quantity: z.string().nullable() }))

const PreviewQuerySchema = z.object({
  from:  z.string().cuid(),
  lines: z.array(LineParam).max(MAX_TRANSFER_LINES),
})

/**
 * The transfer form's live preview: the sender's stock and, per line, the
 * lots it would take and their value. Read-only; same guard as the rest of
 * /api/transfers.
 */
export async function GET(req: NextRequest) {
  try {
    const parsed = PreviewQuerySchema.safeParse({
      from:  req.nextUrl.searchParams.get('from'),
      lines: req.nextUrl.searchParams.getAll('line'),
    })
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await StockTransferService.preview({ fromBranchId: parsed.data.from, lines: parsed.data.lines })
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ preview: result.data })
  } catch (err) {
    console.error('[GET /api/transfers/preview]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
