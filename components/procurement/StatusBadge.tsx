/**
 * Status pill for workflow documents.
 *
 * No 'use client' — it has no interactivity, so it renders on the server and
 * ships zero JavaScript to the browser. Covers PRStatus, POStatus, RRStatus
 * ProductionStatus, TransferStatus and StockRequestStatus: the enums share most
 * values and all of the styling.
 */
const STATUS_STYLES: Record<string, string> = {
  DRAFT:              'bg-gray-100 text-gray-600',
  PENDING_APPROVAL:   'bg-amber-50 text-amber-700',
  SUBMITTED:          'bg-amber-50 text-amber-700',
  APPROVED:           'bg-emerald-50 text-emerald-700',
  REJECTED:           'bg-red-50 text-red-700',
  CONVERTED_TO_PO:    'bg-blue-50 text-blue-700',
  SENT:               'bg-blue-50 text-blue-700',
  PARTIALLY_RECEIVED: 'bg-amber-50 text-amber-700',
  FULLY_RECEIVED:     'bg-emerald-50 text-emerald-700',
  IN_PROGRESS:        'bg-blue-50 text-blue-700',
  PENDING_COMPLETION: 'bg-violet-50 text-violet-700',
  COMPLETED:         'bg-emerald-50 text-emerald-700',
  CANCELLED:          'bg-gray-100 text-gray-400',
  RECEIVED:           'bg-emerald-50 text-emerald-700',
  // Stock requests (Week 9 Task 10).
  PLANNED:            'bg-sky-50 text-sky-700',
  DECLINED:           'bg-red-50 text-red-600',
  FULFILLED:          'bg-emerald-50 text-emerald-700',
  PARTLY_FULFILLED:   'bg-amber-50 text-amber-700',
}

/** `label` replaces the status text where the status name would mislead (a return is APPROVED without an approval). */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
        STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600'
      }`}
    >
      {label ?? status.replace(/_/g, ' ')}
    </span>
  )
}