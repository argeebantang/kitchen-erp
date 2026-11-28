import { BomKind, BranchType, Prisma, Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * The starting world a workflow test needs, built fresh after resetDatabase():
 * one central kitchen and one outlet (outlets never cook and hold no raw
 * materials — docs/overview.md), one user per role, a supplier, two priced
 * materials, Lechon with a production recipe, and Lechon Paksiw with a
 * conversion recipe from leftover Lechon.
 *
 * Kept small and fixed on purpose — not the demo seed, which changes with the
 * demo. A test that needs more (stock on hand, a second kitchen) adds it
 * itself, so what it depends on is visible in the test.
 *
 * Written with Prisma directly: these rows are the given, not what is under
 * test. Workflows themselves always go through the services.
 */

const d = (value: string) => new Prisma.Decimal(value)

/** Users can never sign in: the hash is not a bcrypt hash. Tests call services, not /login. */
const NO_LOGIN = 'not-a-bcrypt-hash'

export type World = Awaited<ReturnType<typeof createWorld>>

export async function createWorld() {
  const kg = await prisma.unit.create({ data: { name: 'Kilogram', abbreviation: 'kg' } })
  const pc = await prisma.unit.create({ data: { name: 'Piece', abbreviation: 'pc' } })

  const meat     = await prisma.category.create({ data: { name: 'Meat', type: 'RAW_MATERIAL' } })
  const spices   = await prisma.category.create({ data: { name: 'Spices', type: 'RAW_MATERIAL' } })
  const roasts   = await prisma.category.create({ data: { name: 'Roasts', type: 'FINISHED_GOOD' } })

  const kitchen = await prisma.branch.create({ data: { name: 'Main Kitchen', code: 'MK', type: BranchType.COMMISSARY } })
  const outlet  = await prisma.branch.create({ data: { name: 'Cubao Outlet', code: 'CB', type: BranchType.OUTLET } })

  const user = (role: Role, key: string, branchId: string | null = null) =>
    prisma.user.create({ data: { email: `${key}@test.local`, name: `Test ${key}`, passwordHash: NO_LOGIN, role, branchId } })

  const users = {
    admin:         await user(Role.ADMIN, 'admin'),
    procurement:   await user(Role.PROCUREMENT_MANAGER, 'procurement'),
    production:    await user(Role.PRODUCTION_MANAGER, 'production', kitchen.id),
    accounting:    await user(Role.ACCOUNTING, 'accounting'),
    // A second approver, for "nobody approves their own work" and two-at-once tests.
    accounting2:   await user(Role.ACCOUNTING, 'accounting2'),
    branchManager: await user(Role.BRANCH_MANAGER, 'branch-manager', outlet.id),
    viewer:        await user(Role.VIEWER, 'viewer'),
  }

  const supplier = await prisma.supplier.create({ data: { name: 'Test Meat Supply', leadTimeDays: 2 } })

  const material = (code: string, name: string, categoryId: string, reorderPoint: string) =>
    prisma.material.create({ data: { code, name, categoryId, unitId: kg.id, reorderPoint: d(reorderPoint) } })

  const materials = {
    pork: await material('RM-PORK', 'Whole Pig', meat.id, '50'),
    salt: await material('RM-SALT', 'Rock Salt', spices.id, '5'),
  }

  // Reference prices (no supplier) in force since yesterday, so "today" always
  // finds them. A purchase request has no supplier yet, so only a reference
  // price can cost it (ItemPriceRepository.findPricesAsOf); a test that needs
  // a supplier's own price adds one.
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
  await prisma.itemPrice.createMany({
    data: [
      { materialId: materials.pork.id, unitPrice: d('250'), effectiveDate: yesterday },
      { materialId: materials.salt.id, unitPrice: d('40'),  effectiveDate: yesterday },
    ],
  })

  const lechon = await prisma.finishedGood.create({
    data: { code: 'FG-LECHON', name: 'Lechon', categoryId: roasts.id, unitId: kg.id, sellingPrice: d('900'), shelfLifeHours: 48 },
  })

  // One batch: 10 kg of Lechon from 12 kg pork and 0.5 kg salt.
  const lechonBom = await prisma.bOM.create({
    data: {
      finishedGoodId: lechon.id,
      kind:           BomKind.PRODUCTION,
      batchSize:      d('10'),
      batchUnitId:    kg.id,
      items: {
        create: [
          { materialId: materials.pork.id, quantity: d('12'),  unitId: kg.id },
          { materialId: materials.salt.id, quantity: d('0.5'), unitId: kg.id },
        ],
      },
    },
  })

  // A conversion recipe (Week 7): leftover Lechon cooked into Paksiw. Per
  // batch, 5 kg Lechon + 0.25 kg salt make 6 kg Paksiw.
  const paksiw = await prisma.finishedGood.create({
    data: { code: 'FG-PAKSIW', name: 'Lechon Paksiw', categoryId: roasts.id, unitId: kg.id, sellingPrice: d('450'), shelfLifeHours: 24 },
  })
  const paksiwBom = await prisma.bOM.create({
    data: {
      finishedGoodId:       paksiw.id,
      kind:                 BomKind.CONVERSION,
      batchSize:            d('6'),
      batchUnitId:          kg.id,
      sourceFinishedGoodId: lechon.id,
      sourceQuantity:       d('5'),
      items: { create: [{ materialId: materials.salt.id, quantity: d('0.25'), unitId: kg.id }] },
    },
  })

  return {
    units: { kg, pc },
    categories: { meat, spices, roasts },
    branches: { kitchen, outlet },
    users,
    supplier,
    materials,
    finishedGoods: { lechon, paksiw },
    boms: { lechon: lechonBom, paksiw: paksiwBom },
  }
}
