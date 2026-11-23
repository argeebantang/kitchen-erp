import { NextRequest, NextResponse } from 'next/server'
import { HolidayService } from '@/services/holiday.service'
import { HolidaySchema } from './schema'

/** Master Data → Holidays: add a day (Week 10 Task 5). ADMIN only (middleware). */
export async function POST(req: NextRequest) {
  try {
    const parsed = HolidaySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', fields: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const result = await HolidayService.create(parsed.data)
    if (!result.success) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ holiday: result.data }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/holidays]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
