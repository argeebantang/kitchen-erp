/**
 * Status pill for procurement documents.
 *
 * No 'use client' — it has no interactivity, so it renders on the server and
 * ships zero JavaScript to the browser. Covers both PRStatus and POStatus:
 * the enums share most values and all of the styling.
 */
const STATUS_STYLES: Record<string, string> = {
  DRAFT:              'bg-gray-100 text-gray-600',
  PENDING_APPROVAL:   'bg-amber-50 text-amber-700',
  APPROVED:           'bg-emerald-50 text-emerald-700',
  REJECTED:           'bg-red-50 text-red-700',
  CONVERTED_TO_PO:    'bg-blue-50 text-blue-700',
  SENT:               'bg-blue-50 text-blue-700',
  PARTIALLY_RECEIVED: 'bg-amber-50 text-amber-700',
  FULLY_RECEIVED:     'bg-emerald-50 text-emerald-700',
  CANCELLED:          'bg-gray-100 text-gray-400',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
        STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600'
      }`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  )
}