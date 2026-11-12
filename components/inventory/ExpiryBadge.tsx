import { formatTimeLeft, type ExpiryFlag } from '@/lib/dates'

/**
 * A lot's expiry flag (Week 7 Task 3, X1): Expired, "Expires in 5 h" (within
 * 24 h — use or convert today) or "Expires in 30 h" (within 48 h); nothing
 * when it has longer. No hooks and no 'use client', so it renders on the
 * server pages and inside the client forms alike.
 */
const STYLES: Record<ExpiryFlag['status'], string> = {
  EXPIRED:    'bg-red-100 text-red-700',
  WITHIN_24H: 'bg-orange-100 text-orange-700',
  WITHIN_48H: 'bg-amber-100 text-amber-800',
  OK:         '',
}

export function ExpiryBadge({ flag }: { flag: ExpiryFlag | null }) {
  if (flag === null || flag.status === 'OK') return null
  return (
    <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-semibold ${STYLES[flag.status]}`}>
      {flag.status === 'EXPIRED' ? 'Expired' : `Expires in ${formatTimeLeft(flag.minutesLeft)}`}
    </span>
  )
}

/** Row tint for a lot by its flag — red, orange, amber — so the urgent ones stand out in a long list. */
export function expiryRowClass(flag: ExpiryFlag | null): string {
  switch (flag?.status) {
    case 'EXPIRED':    return 'bg-red-50/60 hover:bg-red-50'
    case 'WITHIN_24H': return 'bg-orange-50/60 hover:bg-orange-50'
    case 'WITHIN_48H': return 'bg-amber-50/40 hover:bg-amber-50/70'
    default:           return 'hover:bg-gray-50'
  }
}
