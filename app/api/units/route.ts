import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ReferenceDataService } from '@/services/reference-data.service'

const CreateUnitSchema = z.object({
  name:         z.string().trim().min(1).max(50),
  abbreviation: z.string().trim().min(1).max(10),
})

export async function GET() {
  try {
    return NextResponse.json({ units: await ReferenceDataService.listUnits() })
  } catch (err) {
    console.error('[GET /api/units]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = CreateUnitSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await ReferenceDataService.createUnit(parsed.data)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ unit: result.data }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/units]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
