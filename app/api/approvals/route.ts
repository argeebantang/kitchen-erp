import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PurchaseRequestService } from '@/services/purchase-request.service'
import { PurchaseOrderService } from '@/services/purchase-order.service'
import { ReceivingReportService } from '@/services/receiving-report.service'
import { ProductionOrderService } from '@/services/production-order.service'
import { ConversionOrderService } from '@/services/conversion-order.service'
import { WriteOffService } from '@/services/write-off.service'
import { StockTransferService } from '@/services/stock-transfer.service'


const DecisionSchema = z.object({
  // ProductionCompletion = the kitchen's completion report on a production
  // order (referenceId is the order), decided separately from its plan.
  // ConversionOrder = a recorded conversion (Week 7 Task 1); WriteOff = a
  // recorded write-off of a finished-goods lot (Week 7 Task 2);
  // StockTransfer = a Transfer Order, approving it dispatches (Week 8 Task 3).
  referenceType: z.enum(['PurchaseRequest', 'PurchaseOrder', 'ReceivingReport', 'ProductionOrder', 'ProductionCompletion', 'ConversionOrder', 'WriteOff', 'StockTransfer']),
  referenceId:   z.string().cuid(),
  decision:      z.enum(['APPROVED', 'REJECTED']),
  remarks:       z.string().trim().max(1000).nullish(),
})

export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')

    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = DecisionSchema.safeParse(await req.json())

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { referenceType, referenceId, decision } = parsed.data
    const remarks = parsed.data.remarks ?? null
    const viewer  = { userId, role }

    if (referenceType === 'StockTransfer') {
      const result = await StockTransferService.applyDecision(referenceId, viewer, decision, remarks)

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }

      return NextResponse.json({ transfer: result.data })
    }

    if (referenceType === 'WriteOff') {
      const result = await WriteOffService.applyDecision(referenceId, viewer, decision, remarks)

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }

      return NextResponse.json({ writeOff: result.data })
    }

    if (referenceType === 'ConversionOrder') {
      const result = await ConversionOrderService.applyDecision(referenceId, viewer, decision, remarks)

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }

      return NextResponse.json({ conversionOrder: result.data })
    }

    if (referenceType === 'ProductionCompletion') {
      const result = await ProductionOrderService.applyCompletionDecision(referenceId, viewer, decision, remarks)

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }

      return NextResponse.json({ productionOrder: result.data })
    }

    if (referenceType === 'ProductionOrder') {
      const result = await ProductionOrderService.applyDecision(referenceId, viewer, decision, remarks)

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }

      return NextResponse.json({ productionOrder: result.data })
    }

    if (referenceType === 'ReceivingReport') {
      const result = await ReceivingReportService.applyDecision(referenceId, viewer, decision, remarks)

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }

      return NextResponse.json({ receivingReport: result.data })
    }

    if (referenceType === 'PurchaseOrder') {
      const result = await PurchaseOrderService.applyDecision(referenceId, viewer, decision, remarks)

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }

      return NextResponse.json({ purchaseOrder: result.data })
    }

    const result = await PurchaseRequestService.applyDecision(referenceId, viewer, decision, remarks)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ purchaseRequest: result.data })

  } catch (err) {
    console.error('[POST /api/approvals]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
