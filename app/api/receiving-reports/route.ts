import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ReceivingReportService } from '@/services/receiving-report.service'

const NonNegativeDecimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'Must be a non-negative decimal')

// Shape only. The rules that need the database or Decimal arithmetic (rejected
// ≤ received, accepted ≤ outstanding, PO is receivable, no other open report)
// belong to ReceivingReportService.create.
const CreateReceivingReportSchema = z.object({
  purchaseOrderId: z.string().cuid(),
  branchId:   z.string().cuid(),
  receivedAt: z.string().date(),
  notes:      z.string().trim().max(1000).nullish(),
  items: z
    .array(
      z.object({
        purchaseOrderItemId: z.string().cuid(),
        receivedQuantity:    NonNegativeDecimalString,
        rejectedQuantity:    NonNegativeDecimalString,
        notes:               z.string().trim().max(500).nullish(),
      }),
    )
    .min(1, 'A receiving report needs at least one line'),
})

export async function POST(req: NextRequest) {

  try {
    // The receiver is NEVER read from the body, same as the requester on a
    // purchase request — see docs/coding-conventions.md.
    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')

    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = CreateReceivingReportSchema.safeParse(await req.json())

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await ReceivingReportService.create(parsed.data, { userId, role })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ receivingReport: result.data }, { status: 201 })

  } catch (err) {
    console.error('[POST /api/receiving-reports]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
