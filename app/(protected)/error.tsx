'use client'

import { ErrorState } from '@/components/ui/ErrorState'

/**
 * Any page under the protected layout that fails — a query that throws, the
 * database dropping out between clicks. It renders inside the layout, so the
 * sidebar stays and the user can move on (Week 12 Task 1). A failure in the
 * layout itself is app/error.tsx's.
 */
export default function ProtectedError({ error, reset }: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorState error={error} reset={reset} />
}
