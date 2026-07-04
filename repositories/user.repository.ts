import { prisma } from '@/lib/prisma'
import { Role } from '@prisma/client'

export type CreateUserInput = {
  email: string
  name: string
  passwordHash: string
  role: Role
  branchId?: string
}

// The shape we safely return to services — never includes passwordHash
export type SafeUser = {
  id: string
  email: string
  name: string
  role: Role
  branchId: string | null
}

const safeUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  branchId: true,
} as const

export const UserRepository = {
  async findByEmail(email: string) {
    return prisma.user.findUnique({
      where: { email },
      // We need passwordHash here for login verification
      // but only this repository ever touches it
    })
  },

  async findById(id: string): Promise<SafeUser | null> {
    return prisma.user.findUnique({
      where: { id },
      select: safeUserSelect,
    })
  },

  async existsByEmail(email: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    })
    return user !== null
  },

  async create(data: CreateUserInput): Promise<SafeUser> {
    return prisma.user.create({
      data,
      select: safeUserSelect,
    })
  },
}
