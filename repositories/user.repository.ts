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

    /** Users holding any of the given roles — used to fan a notification out to approvers. */
  async findByRoles(roles: Role[]): Promise<SafeUser[]> {
    return prisma.user.findMany({
      where:   { role: { in: roles } },
      select:  safeUserSelect,
      orderBy: { name: 'asc' },
    })
  },

  /** Everyone with their notification address, for Admin → Email (Week 11 Task 2). Admins first, then by role and name. */
  async listWithNotificationEmail() {
    return prisma.user.findMany({
      select:  { ...safeUserSelect, notificationEmail: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    })
  },

  /** Where this user's emails go; null stops them. Returns false when there is no such user. */
  async setNotificationEmail(id: string, notificationEmail: string | null): Promise<boolean> {
    const { count } = await prisma.user.updateMany({ where: { id }, data: { notificationEmail } })
    return count === 1
  },

  async findNotificationEmail(id: string): Promise<{ name: string; notificationEmail: string | null } | null> {
    return prisma.user.findUnique({ where: { id }, select: { name: true, notificationEmail: true } })
  },
}
