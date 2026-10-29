import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { todayIsoDate } from '@/lib/dates'
import { ReceivingReportService } from '@/services/receiving-report.service'
import { ReceivingReportForm } from '@/components/procurement/ReceivingReportForm'

type PageProps = {
  searchParams: Promise<{ po?: string }>
}

export default async function NewReceivingReportPage({ searchParams }: PageProps) {
  // searchParams is a Promise in Next.js 15, same as params on the detail pages.
  const { po: purchaseOrderId } = await searchParams
  if (!purchaseOrderId) notFound()

  const result = await ReceivingReportService.getForm(purchaseOrderId)
  if (!result.success) notFound()
  const form = result.data

  return (
    <div>
      <Link
        href={`/procurement/orders/${form.purchaseOrderId}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
      >
        <ArrowLeft size={15} />
        {form.poNumber}
      </Link>

      <h1 className="text-2xl font-bold text-gray-800">Receive delivery</h1>
      <p className="mb-6 mt-1 text-sm text-gray-400">
        <span className="font-mono">{form.poNumber}</span> from {form.supplierName ?? 'no supplier'}. Count what
        arrived on every line; anything refused at the door goes under Rejected.
      </p>

      {/* The service refuses all three cases too; these explain why up front. */}
      {!form.receivable ? (
        <Blocked
          title="This order cannot be received"
          body="Only a sent or partially received order with something still outstanding can take a delivery."
        />
      ) : form.openReport ? (
        <Blocked
          title={`${form.openReport.rrNumber} is already open on this order`}
          body="One delivery is recorded at a time. Finish or correct the open report before starting another."
        />
      ) : form.branches.length === 0 ? (
        <Blocked title="No branch to receive into" body="Add an active branch first." />
      ) : (
        <ReceivingReportForm
          purchaseOrderId={form.purchaseOrderId}
          branches={form.branches}
          today={todayIsoDate()}
          lines={form.lines}
          initial={{ branchId: form.branches[0].id, receivedAt: todayIsoDate(), notes: '' }}
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
