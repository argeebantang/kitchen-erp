'use client'

import { ErrorState } from '@/components/ui/ErrorState'

/**
 * A failure outside the protected pages' own error boundary: the protected
 * layout itself (it loads the signed-in user, so this is what a database
 * outage on a full page load shows), the login page, the roadmap. There is no
 * sidebar at this level, so the card is centred on the page (Week 12 Task 1).
 */
export default function AppError({ error, reset }: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-lg">
        <ErrorState error={error} reset={reset} />
      </div>
    </main>
  )
}
