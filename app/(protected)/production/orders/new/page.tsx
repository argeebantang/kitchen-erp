import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { todayIsoDate } from '@/lib/dates'
import { MAX_BATCH_COUNT, ProductionOrderService } from '@/services/production-order.service'
import { ProductionOrderForm } from '@/components/production/ProductionOrderForm'

export default async function NewProductionOrderPage() {
  const { goods, branches } = await ProductionOrderService.getForm()
  const today = todayIsoDate()

  return (
    <div>
      <Link
        href="/production/orders"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
      >
        <ArrowLeft size={15} />
        Production orders
      </Link>

      <h1 className="text-2xl font-bold text-gray-800">New production order</h1>
      <p className="mb-6 mt-1 text-sm text-gray-400">
        Saved as a draft. The order uses the finished good&apos;s active BOM version at the time you save.
      </p>

      {/* The service refuses both cases too; these explain why up front. */}
      {goods.length === 0 ? (
        <Blocked
          title="Nothing to produce yet"
          body="A finished good needs an active BOM before it can be planned. Create one under Bill of Materials."
        />
      ) : branches.length === 0 ? (
        <Blocked title="No branch to produce at" body="Add an active branch first." />
      ) : (
        <ProductionOrderForm
          goods={goods}
          branches={branches}
          today={today}
          maxBatchCount={MAX_BATCH_COUNT}
          initial={{
            finishedGoodId: '',
            batchWeight:    '',
            batchCount:     '1',
            plannedDate:    today,
            // Oldest active branch first: Main Commissary, where production happens.
            branchId:       branches[0].id,
            notes:          '',
          }}
        />
      )}
    </div>
  )
}

function Blocked({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
      <p className="text-sm font-medium text-gray-600">{title}</p>
      <p className="mt-1 text-sm text-gray-400">{body}</p>
    </div>
  )
}
