import { MaterialService } from '@/services/material.service'
import { FinishedGoodService } from '@/services/finished-good.service'
import { ReferenceDataService } from '@/services/reference-data.service'
import { SupplierRepository } from '@/repositories/supplier.repository'
import { MasterTabs, isMasterTab, type MasterTabKey } from '@/components/master/MasterTabs'
import { MaterialsPanel } from '@/components/master/MaterialsPanel'
import { FinishedGoodsPanel } from '@/components/master/FinishedGoodsPanel'
import { ReferenceDataPanel } from '@/components/master/ReferenceDataPanel'

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
    <div className="max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Master Data</h1>
        <p className="mt-1 text-sm text-gray-400">
          Materials, finished goods, and the categories and units they reference
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
    </div>
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
    />
  )
}
