'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { primaryButtonClass } from '@/components/ui/form'

/**
 * Asks for a batch's cost explanation (Week 9 Task 2, E6): "Explain this
 * batch" when there is none, "Try again" after a failure. The route only
 * queues the job; the refresh then shows the pending state, and the order
 * page polls until the worker has written it.
 */
export function ExplainBatchButton({ productionOrderId, label }: { productionOrderId: string; label: string }) {
  const router = useRouter()
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function explain() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/ai/cost-variance', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ productionOrderId }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        setError(body?.error ?? 'Could not ask for an explanation.')
        return
      }
      router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2">
      <button type="button" onClick={explain} disabled={busy} className={`${primaryButtonClass} inline-flex items-center gap-1.5 px-3 py-1.5`}>
        <Sparkles size={14} aria-hidden="true" />
        {busy ? 'Asking…' : label}
      </button>
      <span className="ml-2 text-xs text-gray-400">Costs less than a cent.</span>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  )
}
