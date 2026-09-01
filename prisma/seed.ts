import { PrismaClient, Role } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

// ─── REFERENCE DATA ──────────────────────────────────────────────────────────

const UNITS = [
  { name: 'Kilogram', abbreviation: 'kg' },
  { name: 'Gram',     abbreviation: 'g' },
  { name: 'Liter',    abbreviation: 'L' },
  { name: 'Piece',    abbreviation: 'pc' },
]

const CATEGORIES = [
  { name: 'Meat & Offal',           type: 'RAW_MATERIAL' },
  { name: 'Produce',                type: 'RAW_MATERIAL' },
  { name: 'Seasonings & Condiments', type: 'RAW_MATERIAL' },
  { name: 'Cooked Dishes',          type: 'FINISHED_GOOD' },
]

// ─── MATERIALS ───────────────────────────────────────────────────────────────
// price is the reference price (ItemPrice with supplierId = null), in PHP.

type SeedMaterial = {
  code: string
  name: string
  category: string
  unit: string
  reorderPoint: string
  price: string
}

const MATERIALS: SeedMaterial[] = [
  { code: 'RM-PORK-BELLY',  name: 'Pork Belly',              category: 'Meat & Offal',            unit: 'kg', reorderPoint: '20', price: '380.00' },
  { code: 'RM-PORK-BLOOD',  name: 'Pork Blood',              category: 'Meat & Offal',            unit: 'L',  reorderPoint: '15', price: '90.00'  },
  { code: 'RM-PORK-LUNGS',  name: 'Pork Lungs',              category: 'Meat & Offal',            unit: 'kg', reorderPoint: '10', price: '180.00' },
  { code: 'RM-PORK-HEART',  name: 'Pork Heart',              category: 'Meat & Offal',            unit: 'kg', reorderPoint: '8',  price: '260.00' },
  { code: 'RM-LECHON',      name: 'Roasted Pork (Lechon)',   category: 'Meat & Offal',            unit: 'kg', reorderPoint: '12', price: '520.00' },
  { code: 'RM-GARLIC',      name: 'Garlic',                  category: 'Produce',                 unit: 'kg', reorderPoint: '5',  price: '180.00' },
  { code: 'RM-ONION-RED',   name: 'Red Onion',               category: 'Produce',                 unit: 'kg', reorderPoint: '8',  price: '140.00' },
  { code: 'RM-GINGER',      name: 'Ginger',                  category: 'Produce',                 unit: 'kg', reorderPoint: '3',  price: '120.00' },
  { code: 'RM-CHILI-HABA',  name: 'Green Chili (Siling Haba)', category: 'Produce',               unit: 'kg', reorderPoint: '3',  price: '200.00' },
  { code: 'RM-BELL-RED',    name: 'Red Bell Pepper',         category: 'Produce',                 unit: 'kg', reorderPoint: '4',  price: '240.00' },
  { code: 'RM-CARROT',      name: 'Carrot',                  category: 'Produce',                 unit: 'kg', reorderPoint: '6',  price: '110.00' },
  { code: 'RM-VINEGAR',     name: 'Cane Vinegar',            category: 'Seasonings & Condiments', unit: 'L',  reorderPoint: '10', price: '65.00'  },
  { code: 'RM-OIL',         name: 'Cooking Oil',             category: 'Seasonings & Condiments', unit: 'L',  reorderPoint: '10', price: '95.00'  },
  { code: 'RM-SALT',        name: 'Salt',                    category: 'Seasonings & Condiments', unit: 'kg', reorderPoint: '5',  price: '25.00'  },
  { code: 'RM-PEPPER',      name: 'Black Pepper (Ground)',   category: 'Seasonings & Condiments', unit: 'kg', reorderPoint: '2',  price: '850.00' },
  { code: 'RM-BAYLEAF',     name: 'Bay Leaf (Dried)',        category: 'Seasonings & Condiments', unit: 'kg', reorderPoint: '1',  price: '900.00' },
  { code: 'RM-SUGAR-BROWN', name: 'Brown Sugar',             category: 'Seasonings & Condiments', unit: 'kg', reorderPoint: '8',  price: '78.00'  },
  { code: 'RM-LIVER-SAUCE', name: 'Lechon Liver Sauce',      category: 'Seasonings & Condiments', unit: 'kg', reorderPoint: '5',  price: '210.00' },
  { code: 'RM-ANNATTO',     name: 'Annatto Powder',          category: 'Seasonings & Condiments', unit: 'kg', reorderPoint: '1',  price: '480.00' },
]

/**
 * Extra historical prices, to make the effective-dated lookup demonstrable
 * rather than theoretical. Each material above gets a current reference price;
 * these add earlier rows so "price as of date X" returns different answers for
 * different X, and the price history panel has something to show.
 */
const PRICE_HISTORY: { code: string; price: string; effectiveDate: string; note: string }[] = [
  { code: 'RM-PORK-BELLY', price: '340.00', effectiveDate: '2026-05-01', note: 'Pre-holiday contract rate' },
  { code: 'RM-PORK-BELLY', price: '365.00', effectiveDate: '2026-07-01', note: 'Supply tightening' },
  { code: 'RM-ONION-RED',  price: '95.00',  effectiveDate: '2026-05-01', note: 'Harvest season low' },
  { code: 'RM-ONION-RED',  price: '175.00', effectiveDate: '2026-07-15', note: 'Off-season spike' },
  { code: 'RM-LECHON',     price: '480.00', effectiveDate: '2026-06-01', note: 'Previous supplier rate' },
]

// ─── FINISHED GOODS & BOMs ───────────────────────────────────────────────────
// Quantities are per ONE BATCH of batchSize, as the recipe card is written.

type SeedBom = {
  code: string
  name: string
  description: string
  sellingPrice: string
  batchSize: string
  batchUnit: string
  notes: string
  lines: { code: string; quantity: string; notes?: string }[]
}

const FINISHED_GOODS: SeedBom[] = [
  {
    code:         'FG-DINUGUAN',
    name:         'Dinuguan',
    description:  'Pork stewed in blood, vinegar and chili.',
    sellingPrice: '260.00',
    batchSize:    '10',
    batchUnit:    'kg',
    notes:        'Simmer 45–60 min. Add vinegar without stirring, then boil off the sharpness.',
    lines: [
      { code: 'RM-PORK-BELLY', quantity: '4' },
      { code: 'RM-PORK-BLOOD', quantity: '2.5', notes: 'Strain before adding' },
      { code: 'RM-VINEGAR',    quantity: '0.5' },
      { code: 'RM-ONION-RED',  quantity: '0.3' },
      { code: 'RM-GARLIC',     quantity: '0.15' },
      { code: 'RM-CHILI-HABA', quantity: '0.1' },
      { code: 'RM-GINGER',     quantity: '0.05' },
      { code: 'RM-OIL',        quantity: '0.2' },
      { code: 'RM-SALT',       quantity: '0.04' },
      { code: 'RM-PEPPER',     quantity: '0.01' },
      { code: 'RM-BAYLEAF',    quantity: '0.005' },
    ],
  },
  {
    code:         'FG-LECHON-PAKSIW',
    name:         'Lechon Paksiw',
    description:  'Roast pork simmered in liver sauce, vinegar and sugar.',
    sellingPrice: '320.00',
    batchSize:    '10',
    batchUnit:    'kg',
    notes:        'Uses day-old lechon. Simmer until the sauce coats the meat.',
    lines: [
      { code: 'RM-LECHON',      quantity: '6', notes: 'Day-old roast, chopped' },
      { code: 'RM-LIVER-SAUCE', quantity: '1.5' },
      { code: 'RM-VINEGAR',     quantity: '0.6' },
      { code: 'RM-SUGAR-BROWN', quantity: '0.35' },
      { code: 'RM-ONION-RED',   quantity: '0.25' },
      { code: 'RM-GARLIC',      quantity: '0.12' },
      { code: 'RM-SALT',        quantity: '0.03' },
      { code: 'RM-PEPPER',      quantity: '0.012' },
      { code: 'RM-BAYLEAF',     quantity: '0.006' },
    ],
  },
  {
    code:         'FG-BOPIS',
    name:         'Bopis',
    description:  'Minced pork lungs and heart sautéed with annatto and chili.',
    sellingPrice: '280.00',
    batchSize:    '8',
    batchUnit:    'kg',
    notes:        'Boil offal first, then mince fine. Sauté until liquid reduces.',
    lines: [
      { code: 'RM-PORK-LUNGS', quantity: '3', notes: 'Boil then mince' },
      { code: 'RM-PORK-HEART', quantity: '1.5', notes: 'Boil then mince' },
      { code: 'RM-ONION-RED',  quantity: '0.4' },
      { code: 'RM-CARROT',     quantity: '0.4' },
      { code: 'RM-BELL-RED',   quantity: '0.3' },
      { code: 'RM-GARLIC',     quantity: '0.15' },
      { code: 'RM-CHILI-HABA', quantity: '0.12' },
      { code: 'RM-GINGER',     quantity: '0.08' },
      { code: 'RM-VINEGAR',    quantity: '0.4' },
      { code: 'RM-OIL',        quantity: '0.25' },
      { code: 'RM-SALT',       quantity: '0.035' },
      { code: 'RM-ANNATTO',    quantity: '0.03' },
      { code: 'RM-PEPPER',     quantity: '0.012' },
      { code: 'RM-BAYLEAF',    quantity: '0.005' },
    ],
  },
]

async function main() {
  // ── Users ──────────────────────────────────────────────────────────────────
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
    console.log(`  ✓ ${user.role.padEnd(20)} ${user.email}`)
  }

  // ── Units & categories ─────────────────────────────────────────────────────
  console.log('\nSeeding units and categories...')

  const unitByAbbr = new Map<string, string>()
  for (const unit of UNITS) {
    const row = await prisma.unit.upsert({
      where:  { name: unit.name },
      update: {},
      create: unit,
    })
    unitByAbbr.set(row.abbreviation, row.id)
  }
  console.log(`  ✓ ${UNITS.length} units`)

  const categoryByName = new Map<string, string>()
  for (const category of CATEGORIES) {
    const row = await prisma.category.upsert({
      where:  { name: category.name },
      update: {},
      create: category,
    })
    categoryByName.set(row.name, row.id)
  }
  console.log(`  ✓ ${CATEGORIES.length} categories`)

  // ── Suppliers ──────────────────────────────────────────────────────────────
  // One supplier so the supplier-specific price path is exercisable.
  let supplier = await prisma.supplier.findFirst({ where: { name: 'Bantang Meat Supply' } })
  if (!supplier) {
    supplier = await prisma.supplier.create({
      data: {
        name:        'Bantang Meat Supply',
        contactName: 'Rolando Bantang',
        email:       'orders@bantangmeat.example',
        phone:       '+63 917 555 0142',
      },
    })
  }
  console.log(`  ✓ 1 supplier`)

  // ── Materials ──────────────────────────────────────────────────────────────
  console.log('\nSeeding materials...')

  const materialByCode = new Map<string, string>()
  for (const material of MATERIALS) {
    const categoryId = categoryByName.get(material.category)
    const unitId     = unitByAbbr.get(material.unit)
    if (!categoryId || !unitId) throw new Error(`Missing reference data for ${material.code}`)

    const row = await prisma.material.upsert({
      where:  { code: material.code },
      update: {},
      create: {
        code:         material.code,
        name:         material.name,
        categoryId,
        unitId,
        reorderPoint: material.reorderPoint,
        // standardCost is deprecated in favour of ItemPrice and nothing reads
        // it. Written here only so the column isn't misleadingly zero while it
        // still exists. See docs/database.md.
        standardCost: material.price,
      },
    })
    materialByCode.set(material.code, row.id)
  }
  console.log(`  ✓ ${MATERIALS.length} materials`)

  // ── Item prices ────────────────────────────────────────────────────────────
  // Idempotent by skipping any material that already has price rows — prices
  // are append-only, so re-running must not stack duplicates.
  console.log('\nSeeding item prices...')

  let priceCount = 0
  for (const material of MATERIALS) {
    const materialId = materialByCode.get(material.code)!

    const existing = await prisma.itemPrice.count({ where: { materialId } })
    if (existing > 0) continue

    const history = PRICE_HISTORY.filter(h => h.code === material.code)

    for (const entry of history) {
      await prisma.itemPrice.create({
        data: {
          materialId,
          unitPrice:     entry.price,
          effectiveDate: new Date(entry.effectiveDate),
          note:          entry.note,
        },
      })
      priceCount++
    }

    // The current reference price, effective from the start of this month.
    await prisma.itemPrice.create({
      data: {
        materialId,
        unitPrice:     material.price,
        effectiveDate: new Date('2026-08-01'),
        note:          'Current reference price',
      },
    })
    priceCount++
  }

  // One supplier-specific quote, to demonstrate the supplier → reference
  // fallback in ItemPriceRepository.findPriceAsOf.
  const porkBellyId = materialByCode.get('RM-PORK-BELLY')!
  const supplierQuoteExists = await prisma.itemPrice.count({
    where: { materialId: porkBellyId, supplierId: supplier.id },
  })
  if (supplierQuoteExists === 0) {
    await prisma.itemPrice.create({
      data: {
        materialId:    porkBellyId,
        supplierId:    supplier.id,
        unitPrice:     '355.00',
        effectiveDate: new Date('2026-08-10'),
        note:          'Negotiated volume rate — beats the reference price',
      },
    })
    priceCount++
  }
  console.log(`  ✓ ${priceCount} price rows`)

  // ── Finished goods & BOMs ──────────────────────────────────────────────────
  console.log('\nSeeding finished goods and BOMs...')

  const dishCategoryId = categoryByName.get('Cooked Dishes')!

  for (const good of FINISHED_GOODS) {
    const unitId = unitByAbbr.get(good.batchUnit)!

    const finishedGood = await prisma.finishedGood.upsert({
      where:  { code: good.code },
      update: {},
      create: {
        code:         good.code,
        name:         good.name,
        description:  good.description,
        categoryId:   dishCategoryId,
        unitId,
        sellingPrice: good.sellingPrice,
      },
    })

    // Skip if a BOM already exists. Re-running the seed must not stack new
    // versions — versions represent real recipe changes, not seed runs.
    const existingBom = await prisma.bOM.findFirst({
      where:  { finishedGoodId: finishedGood.id },
      select: { id: true },
    })

    if (existingBom) {
      console.log(`  · ${good.name.padEnd(16)} BOM already present, skipped`)
      continue
    }

    await prisma.bOM.create({
      data: {
        finishedGoodId: finishedGood.id,
        version:        1,
        isActive:       true,
        batchSize:      good.batchSize,
        batchUnitId:    unitId,
        notes:          good.notes,
        items: {
          create: good.lines.map(line => {
            const materialId = materialByCode.get(line.code)
            if (!materialId) throw new Error(`Unknown material ${line.code} in ${good.code}`)

            const material = MATERIALS.find(m => m.code === line.code)!
            return {
              materialId,
              quantity: line.quantity,
              // Line unit always matches the material's stocking unit — there
              // is no unit conversion layer yet, and BomService rejects a
              // mismatch.
              unitId:   unitByAbbr.get(material.unit)!,
              notes:    line.notes ?? null,
            }
          }),
        },
      },
    })

    console.log(`  ✓ ${good.name.padEnd(16)} v1 · ${good.batchSize}${good.batchUnit} batch · ${good.lines.length} lines`)
  }

  console.log('\nDone. Password for all users: password123')
}

main()
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
