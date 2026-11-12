import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { WriteOffReason } from '@prisma/client'
import { WriteOffService } from '@/services/write-off.service'

// Shape only. The rules that need the database or Decimal arithmetic (the lot
// holds that much at the branch, less pending write-offs; a note for Other)
// belong to WriteOffService.
const CreateWriteOffSchema = z.object({
  lotId:    z.string().cuid(),
  branchId: z.string().cuid(),
  quantity: z.string().regex(/^\d+(\.\d+)?$/, 'Must be a positive decimal'),
  reason:   z.nativeEnum(WriteOffReason),
  notes:    z.string().trim().max(1000).nullish(),
})

/**
 * Records a write-off and submits it for approval in one step — there is no
 * draft (Week 7 Task 2, W4). ADMIN + PRODUCTION_MANAGER (middleware).
 */
export async function POST(req: NextRequest) {
  try {
    // The submitter is NEVER read from the body — see docs/coding-conventions.md.
    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')

    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = CreateWriteOffSchema.safeParse(await req.json())

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await WriteOffService.create(parsed.data, { userId, role })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ writeOff: result.data }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/write-offs]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
