import type { ApprovalDto } from '@/services/purchase-request.service'

/**
 * Who decided a procurement document, when, and why. Newest first, as the
 * service returns them. No 'use client' — it renders on the server.
 */
export function DecisionHistory({ decisions }: { decisions: ApprovalDto[] }) {
  if (decisions.length === 0) return null

  return (
    <div className="mb-6 space-y-2">
      {decisions.map(decision => (
        <div
          key={decision.id}
          className={`rounded-xl border p-4 ${
            decision.decision === 'APPROVED'
              ? 'border-emerald-200 bg-emerald-50'
              : 'border-red-200 bg-red-50'
          }`}
        >
          <p className="text-sm font-medium text-gray-700">
            {decision.decision === 'APPROVED' ? 'Approved' : 'Rejected'} by{' '}
            {decision.approverName} on {decision.decidedAt.slice(0, 10)}
          </p>
          {decision.remarks && (
            <p className="mt-1 text-sm text-gray-600">{decision.remarks}</p>
          )}
        </div>
      ))}
    </div>
  )
}
