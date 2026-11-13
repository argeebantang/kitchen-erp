import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { BranchType } from '@prisma/client'
import { BranchService } from '@/services/branch.service'

const ListQuerySchema = z.object({
  includeInactive: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
})

// Phone is free text within reason — landlines are written "(02) 8123 4567",
// mobiles "+63 917 123 4567". Same fields as PATCH /api/branches/[id].
const CreateBranchSchema = z.object({
  name:    z.string().trim().min(2).max(100),
  type:    z.nativeEnum(BranchType),
  address: z.string().trim().max(300).nullish(),
  phone:   z.string().trim().max(30).regex(/^[0-9+()\-\s]*$/, 'Digits, spaces, + - ( ) only').nullish(),
  // A BRANCH_MANAGER user, or null for none; the service checks the role.
  managerId: z.string().cuid().nullish(),
  // Upper-cased before the check, so "cub" is accepted as CUB.
  code: z.string().trim().transform(value => value.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{2,10}$/, '2–10 letters or digits')),
})

export async function GET(req: NextRequest) {
  try {
    const parsed = ListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams))
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    return NextResponse.json({ branches: await BranchService.list(parsed.data.includeInactive ?? false) })
  } catch (err) {
    console.error('[GET /api/branches]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = CreateBranchSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await BranchService.create(parsed.data)
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ branch: result.data }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/branches]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
