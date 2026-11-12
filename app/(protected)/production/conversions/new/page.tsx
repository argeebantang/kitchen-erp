import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { ConversionOrderService } from '@/services/conversion-order.service'
import { ConversionOrderForm } from '@/components/production/ConversionOrderForm'

export default async function NewConversionOrderPage() {
  const { recipes, branches } = await ConversionOrderService.getForm()

  return (
    <div>
      <Link
        href="/production/conversions"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
      >
        <ArrowLeft size={15} />
        Conversions
      </Link>

      <h1 className="text-2xl font-bold text-gray-800">Record a Conversion</h1>
      <p className="mb-6 mt-1 text-sm text-gray-400">
        Record a conversion the kitchen has done — what it used and what it made. It goes straight to accounting;
        stock moves when they approve it.
      </p>

      {/* The service refuses both cases too; these explain why up front. */}
      {recipes.length === 0 ? (
        <Blocked
          title="No conversion recipe yet"
          body="A finished good needs an active conversion BOM (what it is made from, and the added ingredients) before a conversion can be recorded."
        />
      ) : branches.length === 0 ? (
        <Blocked title="No branch to convert at" body="Add an active branch first." />
      ) : (
        <ConversionOrderForm
          recipes={recipes}
          branches={branches}
          initial={{
            // One recipe today (Paksiw from Lechon): pre-chosen when it is the only one.
            bomId:     recipes.length === 1 ? recipes[0].bomId : '',
            // Oldest active branch first: Main Commissary.
            branchId:  branches[0].id,
            sourceQty: '',
            outputQty: '',
            notes:     '',
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
