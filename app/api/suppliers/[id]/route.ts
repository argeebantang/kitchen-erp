import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { MAX_LEAD_TIME_DAYS, SupplierService } from '@/services/supplier.service'

type RouteContext = {
  params: Promise<{ id: string }>
}

const UpdateSupplierSchema = z.object({
  // Whole days the supplier promises; null clears it (Week 10 Task 3).
  leadTimeDays: z.number().int().min(1).max(MAX_LEAD_TIME_DAYS).nullable(),
})

/** Master Data → Suppliers: set or clear a supplier's promised lead time. ADMIN only (middleware). */
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const parsed = UpdateSupplierSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', fields: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const result = await SupplierService.setLeadTime(id, parsed.data.leadTimeDays)
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ supplier: result.data })
  } catch (err) {
    console.error('[PATCH /api/suppliers/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
