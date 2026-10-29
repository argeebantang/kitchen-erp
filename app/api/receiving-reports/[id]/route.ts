import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ReceivingReportService } from '@/services/receiving-report.service'

type RouteContext = {
  params: Promise<{ id: string }>
}

const NonNegativeDecimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'Must be a non-negative decimal')

// The create schema minus purchaseOrderId: a report cannot move to another order.
const UpdateSchema = z.object({
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

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params

    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')

    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = UpdateSchema.safeParse(await req.json())

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await ReceivingReportService.update(id, parsed.data, { userId, role })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ receivingReport: result.data })
  } catch (err) {
    console.error('[PATCH /api/receiving-reports/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
