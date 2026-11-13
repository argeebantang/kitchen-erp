import { NextRequest, NextResponse } from 'next/server'
import { BranchService } from '@/services/branch.service'

type RouteContext = { params: Promise<{ id: string }> }

// Its own endpoint, like the document transitions (submit, start): ADMIN-only
// through the /api/branches write guard in middleware.ts.
export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const result = await BranchService.deactivate(id)
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ branch: result.data })
  } catch (err) {
    console.error('[POST /api/branches/[id]/deactivate]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
