/**
 * A write-off's reason as a small coloured pill (Week 7 Task 2, W3). No
 * 'use client' — it renders on the server. The label comes from the service
 * (reasonLabel), so the wording lives in one place.
 */
const REASON_STYLES: Record<string, string> = {
  EXPIRED:        'bg-red-50 text-red-700',
  SPOILED:        'bg-amber-50 text-amber-700',
  DAMAGED:        'bg-orange-50 text-orange-700',
  FAILED_QUALITY: 'bg-violet-50 text-violet-700',
  OTHER:          'bg-gray-100 text-gray-600',
}

export function WriteOffReasonBadge({ reason, label }: { reason: string; label: string }) {
  return (
    <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${REASON_STYLES[reason] ?? 'bg-gray-100 text-gray-600'}`}>
      {label}
    </span>
  )
}
