import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { BranchType } from '@prisma/client'
import { BranchService } from '@/services/branch.service'

// No code: it is fixed once created (Week 8 Task 1, B1). Unknown keys are
// stripped, so a code sent anyway is ignored.
// Same field rules as POST /api/branches.
const UpdateBranchSchema = z.object({
  name:    z.string().trim().min(2).max(100).optional(),
  type:    z.nativeEnum(BranchType).optional(),
  address: z.string().trim().max(300).nullish(),
  phone:   z.string().trim().max(30).regex(/^[0-9+()\-\s]*$/, 'Digits, spaces, + - ( ) only').nullish(),
  // A BRANCH_MANAGER user, or null for none; the service checks the role.
  managerId: z.string().cuid().nullish(),
})

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const parsed = UpdateBranchSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await BranchService.update(id, parsed.data)
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ branch: result.data })
  } catch (err) {
    console.error('[PATCH /api/branches/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
