import { MaterialService } from '@/services/material.service'
import { FinishedGoodService, MAX_SHELF_LIFE_HOURS } from '@/services/finished-good.service'
import { ReferenceDataService } from '@/services/reference-data.service'
import { BranchService } from '@/services/branch.service'
import { SupplierRepository } from '@/repositories/supplier.repository'
import { UserRepository } from '@/repositories/user.repository'
import { MasterTabs, isMasterTab, type MasterTabKey } from '@/components/master/MasterTabs'
import { MaterialsPanel } from '@/components/master/MaterialsPanel'
import { FinishedGoodsPanel } from '@/components/master/FinishedGoodsPanel'
import { ReferenceDataPanel } from '@/components/master/ReferenceDataPanel'
import { BranchesPanel } from '@/components/master/BranchesPanel'

// Next.js 15: searchParams is a Promise in Server Components and must be
// awaited. Destructuring it directly (the Next 14 shape) yields undefined.
type PageProps = {
  searchParams: Promise<{ tab?: string }>
}

export default async function MasterDataPage({ searchParams }: PageProps) {
  const { tab } = await searchParams
  const active: MasterTabKey = isMasterTab(tab) ? tab : 'materials'

  // This is a Server Component, so it calls services directly rather than
  // fetching its own API routes — see docs/architecture.md. Every value below
  // has already had its Decimals converted to strings by the service layer,
  // which is what makes it safe to hand to the client panels as props.
  const [categories, units] = await Promise.all([
    ReferenceDataService.listCategories(),
    ReferenceDataService.listUnits(),
  ])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Master Data</h1>
        <p className="mt-1 text-sm text-gray-400">
          Materials, finished goods, the categories and units they reference, and branches
        </p>
      </div>

      <MasterTabs active={active} />

      {active === 'materials' && <MaterialsTab categories={categories} units={units} />}
      {active === 'finished-goods' && <FinishedGoodsTab categories={categories} units={units} />}
      {active === 'categories' && (
        <ReferenceDataPanel kind="categories" categories={categories} units={units} />
      )}
      {active === 'units' && (
        <ReferenceDataPanel kind="units" categories={categories} units={units} />
      )}
      {active === 'branches' && <BranchesTab />}
    </div>
  )
}

async function BranchesTab() {
  const [branches, managers] = await Promise.all([
    BranchService.list(true),
    UserRepository.findByRoles(['BRANCH_MANAGER']),
  ])

  return (
    <BranchesPanel
      branches={branches}
      managers={managers.map(m => ({ id: m.id, name: m.name, email: m.email }))}
    />
  )
}

async function MaterialsTab({
  categories, units,
}: {
  categories: Awaited<ReturnType<typeof ReferenceDataService.listCategories>>
  units: Awaited<ReturnType<typeof ReferenceDataService.listUnits>>
}) {
  const [{ materials }, suppliers] = await Promise.all([
    MaterialService.list({ take: 100 }),
    SupplierRepository.findAllActive(),
  ])

  return (
    <MaterialsPanel
      materials={materials}
      categories={categories.filter(c => c.type !== 'FINISHED_GOOD')}
      units={units}
      suppliers={suppliers}
    />
  )
}

async function FinishedGoodsTab({
  categories, units,
}: {
  categories: Awaited<ReturnType<typeof ReferenceDataService.listCategories>>
  units: Awaited<ReturnType<typeof ReferenceDataService.listUnits>>
}) {
  const { finishedGoods } = await FinishedGoodService.list({ take: 100 })

  return (
    <FinishedGoodsPanel
      finishedGoods={finishedGoods}
      categories={categories.filter(c => c.type === 'FINISHED_GOOD')}
      units={units}
      maxShelfLifeHours={MAX_SHELF_LIFE_HOURS}
    />
  )
}
