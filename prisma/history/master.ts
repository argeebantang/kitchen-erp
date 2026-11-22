import bcrypt from 'bcryptjs'
import { BranchType, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  BACKFILL_PRICE_DATE, BACKFILL_PRICE_NOTE, BACKFILL_PRICES, HISTORY_BRANCHES, HISTORY_STAFF, HISTORY_SUPPLIERS,
  MAIN_KITCHEN_CODE, SUPPLIER_PRICE_FACTOR, SUPPLIER_PRICE_NOTE, type StaffKey,
} from './cast'

/** Ids the simulation works with, resolved once. */
export type Cast = {
  staff: Record<StaffKey, string>
  kitchens: { id: string; code: string; name: string }[]
  outlets: { id: string; code: string; name: string; managerId: string }[]
  suppliers: { id: string; name: string; pattern: string; leadTimeDays: number; materialCodes: string[] }[]
}

/** The seed.ts password, so the history staff can log in on a dev machine like every other seeded user. */
const SEED_PASSWORD = 'password123'

/**
 * People, places, suppliers and prices (subtask 1.1). The caller has checked
 * that no history exists yet; everything here is created, nothing updated,
 * except the outlets' managerId on rows this function made.
 */
export async function createCast(startedAt: Date): Promise<Cast> {
  const main = await prisma.branch.findUnique({ where: { code: MAIN_KITCHEN_CODE } })
  if (!main || main.type !== BranchType.COMMISSARY) {
    throw new Error(`No ${MAIN_KITCHEN_CODE} commissary — run npx prisma db seed first`)
  }
  const taken = await prisma.branch.findMany({
    where:  { OR: [{ code: { in: HISTORY_BRANCHES.map(b => b.code) } }, { name: { in: HISTORY_BRANCHES.map(b => b.name) } }] },
    select: { code: true, name: true },
  })
  if (taken.length > 0) {
    throw new Error(`These branches already exist: ${taken.map(b => `${b.name} (${b.code})`).join(', ')} — rename or remove them first`)
  }

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12)

  return prisma.$transaction(async tx => {
    const branchIds = new Map<string, string>()
    for (const branch of HISTORY_BRANCHES) {
      const row = await tx.branch.create({ data: { ...branch, createdAt: startedAt } })
      branchIds.set(branch.code, row.id)
    }

    const staff = {} as Record<StaffKey, string>
    for (const person of HISTORY_STAFF) {
      const branchId = person.manages ? branchIds.get(person.manages) ?? null : null
      const row = await tx.user.create({
        data: { email: person.email, name: person.name, role: person.role, passwordHash, branchId, createdAt: startedAt },
      })
      staff[person.key] = row.id
      if (person.manages && branchId) {
        await tx.branch.update({ where: { id: branchId }, data: { managerId: row.id } })
      }
    }

    const suppliers: Cast['suppliers'] = []
    for (const supplier of HISTORY_SUPPLIERS) {
      let id: string
      if (supplier.existing) {
        const row = await tx.supplier.findFirst({ where: { name: supplier.name }, select: { id: true } })
        if (!row) throw new Error(`Supplier "${supplier.name}" is missing — run npx prisma db seed first`)
        id = row.id
      } else {
        const row = await tx.supplier.create({
          data: {
            name: supplier.name, contactName: supplier.contactName, phone: supplier.phone, address: supplier.address,
            // What it promises (Week 10 Task 3); its deliveries show what it really does.
            leadTimeDays: supplier.leadTimeDays,
            createdAt: startedAt,
          },
        })
        id = row.id
      }
      suppliers.push({ id, name: supplier.name, pattern: supplier.pattern, leadTimeDays: supplier.leadTimeDays, materialCodes: supplier.materials })
    }

    const materials = await tx.material.findMany({ where: { isActive: true }, select: { id: true, code: true } })
    const materialId = new Map(materials.map(m => [m.code, m.id]))
    const backfillOn = new Date(`${BACKFILL_PRICE_DATE}T00:00:00.000Z`)

    // Reference prices first, so the supplier rates below can be taken from them.
    for (const { code, price } of BACKFILL_PRICES) {
      const id = materialId.get(code)
      if (!id) continue
      const earlier = await tx.itemPrice.count({ where: { materialId: id, supplierId: null, effectiveDate: { lte: backfillOn } } })
      if (earlier > 0) continue
      await tx.itemPrice.create({
        data: { materialId: id, unitPrice: new Prisma.Decimal(price), effectiveDate: backfillOn, note: BACKFILL_PRICE_NOTE },
      })
    }

    // A rate per supplier and material it supplies, unless it has one already:
    // the earliest reference price × SUPPLIER_PRICE_FACTOR, from the same date.
    const factor = new Prisma.Decimal(SUPPLIER_PRICE_FACTOR)
    for (const supplier of suppliers) {
      for (const code of supplier.materialCodes) {
        const id = materialId.get(code)
        if (!id) continue
        const own = await tx.itemPrice.count({ where: { materialId: id, supplierId: supplier.id } })
        if (own > 0) continue
        const reference = await tx.itemPrice.findFirst({
          where: { materialId: id, supplierId: null }, orderBy: { effectiveDate: 'asc' }, select: { unitPrice: true },
        })
        if (!reference) continue
        await tx.itemPrice.create({
          data: {
            materialId: id, supplierId: supplier.id, unitPrice: reference.unitPrice.mul(factor).toDecimalPlaces(2),
            effectiveDate: backfillOn, note: SUPPLIER_PRICE_NOTE,
          },
        })
      }
    }

    const kitchens = [
      { id: main.id, code: main.code, name: main.name },
      ...HISTORY_BRANCHES.filter(b => b.type === BranchType.COMMISSARY).map(b => ({ id: branchIds.get(b.code)!, code: b.code, name: b.name })),
    ]
    const outlets = HISTORY_STAFF.filter(p => p.manages).map(p => {
      const branch = HISTORY_BRANCHES.find(b => b.code === p.manages)!
      return { id: branchIds.get(branch.code)!, code: branch.code, name: branch.name, managerId: staff[p.key] }
    })
    return { staff, kitchens, outlets, suppliers }
  })
}
