import { PrismaClient, Role } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding users...')

  const passwordHash = await bcrypt.hash('password123', 12)

  const users = [
    { email: 'admin@kitchen.com',       name: 'Admin User',       role: Role.ADMIN },
    { email: 'procurement@kitchen.com', name: 'Juan Procurement', role: Role.PROCUREMENT_MANAGER },
    { email: 'production@kitchen.com',  name: 'Maria Production', role: Role.PRODUCTION_MANAGER },
    { email: 'branch@kitchen.com',      name: 'Pedro Branch',     role: Role.BRANCH_MANAGER },
    { email: 'viewer@kitchen.com',      name: 'Ana Viewer',       role: Role.VIEWER },
  ]

  for (const user of users) {
    await prisma.user.upsert({
      where:  { email: user.email },
      update: {},
      create: { ...user, passwordHash },
    })
    console.log(`✓ ${user.role.padEnd(20)} ${user.email}`)
  }

  console.log('\nDone. Password for all users: password123')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
