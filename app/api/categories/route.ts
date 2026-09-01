import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ReferenceDataService } from '@/services/reference-data.service'
import { CATEGORY_TYPES } from '@/repositories/category.repository'

// Category.type is free text in the schema, so the fixed set is enforced here.
const CategoryTypeSchema = z.enum(CATEGORY_TYPES)

const CreateCategorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  type: CategoryTypeSchema,
})

export async function GET(req: NextRequest) {
  try {
    const typeParam = req.nextUrl.searchParams.get('type')

    if (typeParam !== null) {
      const parsed = CategoryTypeSchema.safeParse(typeParam)
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid category type' }, { status: 400 })
      }
      return NextResponse.json({ categories: await ReferenceDataService.listCategories(parsed.data) })
    }

    return NextResponse.json({ categories: await ReferenceDataService.listCategories() })
  } catch (err) {
    console.error('[GET /api/categories]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = CreateCategorySchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await ReferenceDataService.createCategory(parsed.data)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ category: result.data }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/categories]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
