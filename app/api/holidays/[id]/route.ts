import { NextRequest, NextResponse } from 'next/server'
import { HolidayService } from '@/services/holiday.service'
import { HolidaySchema } from '../schema'

type RouteContext = { params: Promise<{ id: string }> }

/** Master Data → Holidays: change a day's date, name or type (Week 10 Task 5). ADMIN only (middleware). */
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const parsed = HolidaySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', fields: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const result = await HolidayService.update(id, parsed.data)
    if (!result.success) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ holiday: result.data })
  } catch (err) {
    console.error('[PATCH /api/holidays/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** Master Data → Holidays: remove a day. ADMIN only (middleware). */
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const result = await HolidayService.remove(id)
    if (!result.success) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result.data)
  } catch (err) {
    console.error('[DELETE /api/holidays/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
