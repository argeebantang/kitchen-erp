import { NextRequest, NextResponse } from 'next/server'
import { PurchaseRequestService } from '@/services/purchase-request.service'

// Next.js 15: params is a Promise in route handlers too, not just pages.
type RouteContext = {
  params: Promise<{ id: string }>
}

/**
 * DRAFT → PENDING_APPROVAL.
 *
 * A distinct URL rather than PATCH { status } on the collection route. The
 * middleware guards by path prefix, so "who may perform this transition" is
 * only expressible if each transition has its own path. Approving lives
 * elsewhere, at /api/approvals, guarded to ACCOUNTING.
 *
 * No request body, so no zod schema — the id comes from the URL and the caller
 * from headers middleware set.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params

    // Both are needed: the service checks ownership (userId) and the ADMIN
    // override (role). Trustworthy only because middleware verified the JWT.
    const userId = req.headers.get('x-user-id')
    const role   = req.headers.get('x-user-role')

    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

     const result = await PurchaseRequestService.submit(id, { userId, role })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ purchaseRequest: result.data })
  } catch (err) {
    console.error('[POST /api/purchase-requests/[id]/submit]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}