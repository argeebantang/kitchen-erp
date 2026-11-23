import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Lock } from 'lucide-react'
import { todayIsoDate } from '@/lib/dates'
import { getSession } from '@/lib/session'
import { trimDecimal } from '@/lib/format'
import { ReceivingReportService } from '@/services/receiving-report.service'
import { ReceivingReportForm } from '@/components/procurement/ReceivingReportForm'
import { EmptyState } from '@/components/ui/states'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function EditReceivingReportPage({ params }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  // Accounting may read /procurement/receiving but not change a count. A
  // middleware prefix cannot single out [id]/edit, so the page checks; the
  // PATCH endpoint is procurement-only in middleware regardless.
  if (session.role !== 'PROCUREMENT_MANAGER' && session.role !== 'ADMIN') redirect('/unauthorized')

  const { id } = await params

  const report = await ReceivingReportService.getById(id)
  if (!report.success) notFound()
  const rr = report.data

  // The same balances and branches the create form uses. Outstanding counts
  // APPROVED reports only, so this draft does not count against itself.
  const form = await ReceivingReportService.getForm(rr.purchaseOrderId)
  if (!form.success) notFound()

  // The branch may have been deactivated since the draft was saved; it stays
  // selectable so opening the edit page does not silently change it.
  const branches = form.data.branches.some(branch => branch.id === rr.branchId)
    ? form.data.branches
    : [{ id: rr.branchId, name: rr.branchName }, ...form.data.branches]

  return (
    <div>
      <Link
        href={`/procurement/receiving/${rr.id}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
      >
        <ArrowLeft size={15} />
        {rr.rrNumber}
      </Link>

      <h1 className="text-2xl font-bold text-gray-800">Edit {rr.rrNumber}</h1>
      <p className="mb-6 mt-1 text-sm text-gray-400">
        Against <span className="font-mono">{rr.poNumber}</span>. Saving makes you the person who counted it.
      </p>

      {rr.status !== 'DRAFT' ? (
        <EmptyState icon={Lock} title="This report can no longer be edited" action={{ href: `/procurement/receiving/${rr.id}`, label: 'Back to the report' }}>
          Only a draft can be changed.
        </EmptyState>
      ) : (
        <ReceivingReportForm
          purchaseOrderId={rr.purchaseOrderId}
          receivingReportId={rr.id}
          branches={branches}
          today={todayIsoDate()}
          lines={form.data.lines}
          initial={{
            branchId:   rr.branchId,
            receivedAt: rr.receivedAt.slice(0, 10),
            notes:      rr.notes ?? '',
            counts: Object.fromEntries(rr.lines.map(line => [
              line.purchaseOrderItemId,
              {
                received: trimDecimal(line.receivedQuantity),
                rejected: trimDecimal(line.rejectedQuantity),
                notes:    line.notes ?? '',
              },
            ])),
          }}
        />
      )}
    </div>
  )
}
