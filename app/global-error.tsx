'use client'

import './globals.css'
import { ErrorState } from '@/components/ui/ErrorState'

/**
 * Last resort: the root layout itself failed, so this replaces it and brings
 * its own <html>, <body> and stylesheet. Next.js uses it in production only;
 * in development its error overlay shows instead (Week 12 Task 1).
 */
export default function GlobalError({ error, reset }: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body>
        <main className="flex min-h-dvh items-center justify-center bg-gray-50 p-6">
          <div className="w-full max-w-lg">
            <ErrorState error={error} reset={reset} />
          </div>
        </main>
      </body>
    </html>
  )
}
