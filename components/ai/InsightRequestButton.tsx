'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw, Sparkles } from 'lucide-react'
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'

/**
 * Asks for an AI insight, or regenerates one (Week 10 Task 2): POST
 * /api/ai/insights, then a refresh shows it being written and the page polls
 * until it is there. `regenerate` is the quieter, secondary button on a
 * written insight. One for every insight type (replaces Week 9's
 * ExplainBatchButton).
 */
export function InsightRequestButton({ type, referenceId, label, regenerate = false, note }: {
  type: string
  referenceId: string
  label: string
  regenerate?: boolean
  /** A hint beside the button, e.g. what it costs. */
  note?: string
}) {
  const router = useRouter()
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function ask() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/ai/insights', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type, referenceId, regenerate }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        setError(body?.error ?? 'Could not ask the AI.')
        return
      }
      router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  const Icon = regenerate ? RefreshCw : Sparkles
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={ask}
        disabled={busy}
        className={`${regenerate ? secondaryButtonClass : primaryButtonClass} inline-flex items-center gap-1.5 px-3 py-1.5 text-sm`}
      >
        <Icon size={14} aria-hidden="true" className={busy ? 'animate-spin' : ''} />
        {busy ? 'Asking…' : label}
      </button>
      {note && <span className="text-xs text-gray-400">{note}</span>}
      {error && <span className="text-sm text-red-700">{error}</span>}
    </span>
  )
}
