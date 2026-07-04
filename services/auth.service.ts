import { Role } from '@prisma/client'
import { hashPassword, verifyPassword, signToken, COOKIE_NAME } from '@/lib/auth'
import { UserRepository, SafeUser } from '@/repositories/user.repository'
import { NextResponse } from 'next/server'

export type RegisterInput = {
  email: string
  name: string
  password: string
  role: Role
  branchId?: string
}

export type LoginInput = {
  email: string
  password: string
}

export type AuthResult =
  | { success: true;  user: SafeUser; token?: string }
  | { success: false; error: string; status: number }

export const AuthService = {
  async register(input: RegisterInput): Promise<AuthResult> {
    const exists = await UserRepository.existsByEmail(input.email)
    if (exists) {
      return { success: false, error: 'Email already registered', status: 409 }
    }

    const passwordHash = await hashPassword(input.password)
    const user = await UserRepository.create({
      email:    input.email,
      name:     input.name,
      passwordHash,
      role:     input.role,
      branchId: input.branchId,
    })

    return { success: true, user }
  },

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await UserRepository.findByEmail(input.email)

    // verifyPassword runs bcrypt regardless of whether user exists
    const valid = await verifyPassword(input.password, user?.passwordHash ?? null)

    if (!user || !valid) {
      return { success: false, error: 'Invalid email or password', status: 401 }
    }

    const token = await signToken({
      userId:   user.id,
      email:    user.email,
      role:     user.role,
      branchId: user.branchId,
    })

    const safeUser: SafeUser = {
      id:       user.id,
      email:    user.email,
      name:     user.name,
      role:     user.role,
      branchId: user.branchId,
    }

    return { success: true, user: safeUser, token }
  },
}

// Shared cookie config — one place to update if cookie settings change
export function buildAuthCookie(token: string) {
  return {
    name:     COOKIE_NAME,
    value:    token,
    options: {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge:   60 * 60 * 8, // 8 hours
      path:     '/',
    },
  }
}

export function clearAuthCookie() {
  return {
    name:    COOKIE_NAME,
    value:   '',
    options: { httpOnly: true, maxAge: 0, path: '/' },
  }
}
