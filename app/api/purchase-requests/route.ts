import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PurchaseRequestService } from '@/services/purchase-request.service'

const PositiveDecimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'Must be a non-negative decimal')

const CreatePurchaseRequestSchema = z.object({
  notes:    z.string().trim().max(1000).nullish(),
  neededBy: z.string().date().nullish(),
  items: z
    .array(
      z.object({
        materialId:        z.string().cuid(),
        quantity:          PositiveDecimalString,
        estimatedUnitCost: PositiveDecimalString.nullish(),
        notes:             z.string().trim().max(500).nullish(),
      }),
    )
    .min(1, 'A purchase request needs at least one line'),
})

export async function POST(req: NextRequest) {

  try {
    // Trustworthy only because middleware verified the JWT and set this header.
    // The requester is NEVER read from the body — otherwise anyone could raise
    // a request in someone else's name. See docs/coding-conventions.md.
    const userId = req.headers.get('x-user-id')

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = CreatePurchaseRequestSchema.safeParse(await req.json())

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    // requestedById comes from the header, never the body — so it is set here,
    // after the spread, where the client cannot influence it.
    const result = await PurchaseRequestService.create({
      ...parsed.data,
      requestedById: userId,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ purchaseRequest: result.data }, { status: 201 })

  } catch (err) {
    console.error('[POST /api/purchase-requests]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}