'use client'

import { useEffect, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'

/**
 * What error.tsx shows when a page fails (Week 12 Task 1): a plain message,
 * Try again, a way home, and the reference code Next.js also prints in the
 * server log next to the real error. The message itself is never shown —
 * in production Next.js hides it anyway, and it can name tables or ids.
 */
export function ErrorState({ error, reset }: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()
  const [retrying, startRetry] = useTransition()

  useEffect(() => {
    // Errors thrown in the browser never reach the server log; this keeps them
    // in the console. Server errors are already logged by Next.js.
    console.error(error)
  }, [error])

  // reset() alone re-renders the cached server payload, which failed. A
  // server-side failure needs the page fetched again — refresh, then reset, in
  // one transition so the error stays on screen until the new page is ready.
  function retry() {
    startRetry(() => {
      router.refresh()
      reset()
    })
  }

  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-white p-10 text-center">
      <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-500">
        <AlertTriangle size={18} aria-hidden="true" />
      </span>
      <p className="text-sm font-medium text-gray-700">Something went wrong loading this page</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-gray-400">
        It may be a brief connection problem — try again in a moment. If it keeps happening, tell your
        administrator{error.digest ? ' and quote the reference below' : ''}.
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <button type="button" onClick={retry} disabled={retrying} className={primaryButtonClass}>
          {retrying ? 'Trying…' : 'Try again'}
        </button>
        <Link href="/dashboard" className={secondaryButtonClass}>Go to Dashboard</Link>
      </div>
      {error.digest && (
        <p className="mt-4 text-xs text-gray-400">
          Reference: <span className="font-mono">{error.digest}</span>
        </p>
      )}
    </div>
  )
}
