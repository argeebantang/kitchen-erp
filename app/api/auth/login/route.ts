import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuthService, buildAuthCookie } from '@/services/auth.service'

const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = LoginSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    }

    const result = await AuthService.login(parsed.data)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    const response = NextResponse.json({ user: result.user }, { status: 200 })
    const cookie = buildAuthCookie(result.token!)
    response.cookies.set(cookie.name, cookie.value, cookie.options)

    return response
  } catch (err) {
    console.error('[POST /api/auth/login]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
