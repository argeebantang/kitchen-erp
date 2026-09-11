import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSession } from '@/lib/session'
import { PurchaseRequestService } from '@/services/purchase-request.service'
import { StatusBadge } from '@/components/procurement/StatusBadge'
import { formatPeso, trimDecimal } from '@/lib/format'
import { PurchaseRequestActions } from '@/components/procurement/PurchaseRequestActions'
import { ApprovalActions } from '@/components/procurement/ApprovalActions'

// Next.js 15: params is a Promise and must be awaited. In Next 14 it was a
// plain object — writing the old shape here silently gives you undefined.
type PageProps = {
  params: Promise<{ id: string }>
}

export default async function PurchaseRequestDetailPage({ params }: PageProps) {
  const { id } = await params

  const session = await getSession()
  if (!session) redirect('/login')

  const result = await PurchaseRequestService.getById(id, {
    userId: session.userId,
    role:   session.role,
  })

  // The service returns 404 both for a missing PR and for someone else's, so
  // this one branch covers both without revealing which.
  if (!result.success) notFound()

  const pr = result.data
  const isDraft      = pr.status === 'DRAFT'
  const isPending    = pr.status === 'PENDING_APPROVAL'
  const isApprover   = session.role === 'ACCOUNTING' || session.role === 'ADMIN'
  const isOwnRequest = pr.requestedById === session.userId

  return (
    <div>
      <Link
        href="/procurement/requests"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
      >
        <ArrowLeft size={15} />
        Purchase Requests
      </Link>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-bold text-gray-800">{pr.prNumber}</h1>
            <StatusBadge status={pr.status} />
          </div>
          <p className="mt-1 text-sm text-gray-400">
            Raised by {pr.requesterName} on {pr.createdAt.slice(0, 10)}
            {pr.neededBy && ` · needed by ${pr.neededBy.slice(0, 10)}`}
          </p>
        </div>

        {/* Hiding the button for non-drafts is convenience only — the service
            re-checks the status and returns 409 if it is not a draft. */}
        {isDraft && <PurchaseRequestActions purchaseRequestId={pr.id} />}
      </div>

      {/* Nobody approves their own request — ADMIN included. That separation is
      the reason the ACCOUNTING role exists. The service enforces it too. */}
      {isPending && isApprover && !isOwnRequest && (
        <ApprovalActions purchaseRequestId={pr.id} />
      )}
      {isPending && isApprover && isOwnRequest && (
        <p className="mb-6 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
          You raised this request, so someone else has to approve it.
        </p>
      )}


      {pr.notes && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Notes</p>
          <p className="text-sm text-gray-700">{pr.notes}</p>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">Material</th>
              <th className="px-4 py-3 text-right font-medium">Quantity</th>
              <th className="px-4 py-3 text-right font-medium">Est. unit cost</th>
              <th className="px-4 py-3 text-right font-medium">Line total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {pr.lines.map(line => (
              <tr key={line.id}>
                <td className="px-4 py-3">
                  <p className="text-gray-700">{line.materialName}</p>
                  <p className="font-mono text-xs text-gray-400">{line.materialCode}</p>
                  {line.notes && <p className="mt-0.5 text-xs text-gray-400">{line.notes}</p>}
                </td>
                <td className="px-4 py-3 text-right text-gray-700">
                  {trimDecimal(line.quantity)}{' '}
                  <span className="text-gray-400">{line.unitAbbreviation}</span>
                </td>
                <td className="px-4 py-3 text-right text-gray-700">
                  {line.estimatedUnitCost === null
                    ? <span className="text-gray-300">—</span>
                    : formatPeso(line.estimatedUnitCost)}
                </td>
                <td className="px-4 py-3 text-right text-gray-700">
                  {line.lineTotal === null
                    ? <span className="text-gray-300">—</span>
                    : formatPeso(line.lineTotal)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-gray-200 bg-gray-50">
            <tr>
              <td colSpan={3} className="px-4 py-3 text-right text-sm text-gray-500">
                Estimated total
              </td>
              <td className="px-4 py-3 text-right text-sm font-semibold text-gray-800">
                {pr.estimatedTotal === null
                  ? <span className="font-normal text-gray-400">Not fully priced</span>
                  : formatPeso(pr.estimatedTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
    
  )
}