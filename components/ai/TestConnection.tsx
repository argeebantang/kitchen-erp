'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import type { AiCompletion } from '@/services/ai.service'
import { formatUsd } from '@/lib/format'
import { inputClass, primaryButtonClass } from '@/components/ui/form'

// In Filipino on purpose: the reply should come back in Filipino too (D7).
const DEFAULT_MESSAGE = 'Kumusta? Pakisabi kung nababasa mo ito.'

/**
 * Sends one short real message to Claude from AI Settings (Week 9 Task 1,
 * D10) and shows the reply with what it cost. Refreshes the page afterwards
 * so the call appears under Latest calls and in this month's spend.
 */
export function TestConnection({ maxLength }: { maxLength: number }) {
  const router = useRouter()
  const [message, setMessage] = useState(DEFAULT_MESSAGE)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [reply, setReply]     = useState<AiCompletion | null>(null)

  async function send(event: React.FormEvent) {
    event.preventDefault()
    if (message.trim() === '') {
      setError('Type a message to send.')
      return
    }

    setBusy(true)
    setError(null)
    setReply(null)
    try {
      const response = await fetch('/api/ai/test', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message }),
      })
      const body = await response.json()
      if (!response.ok) {
        setError(body.error ?? 'The test failed.')
      } else {
        setReply(body.completion)
      }
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
      // Failures are recorded too, so the list changes either way.
      router.refresh()
    }
  }

  return (
    <form onSubmit={send} className="mt-4 border-t border-gray-100 pt-4">
      <label htmlFor="ai-test-message" className="text-sm font-medium text-gray-700">Test connection</label>
      <p className="mt-0.5 text-xs text-gray-400">Sends one short real message to Claude — costs a fraction of a cent.</p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id="ai-test-message"
          className={inputClass}
          value={message}
          maxLength={maxLength}
          onChange={event => setMessage(event.target.value)}
          disabled={busy}
        />
        <button type="submit" className={`${primaryButtonClass} whitespace-nowrap`} disabled={busy}>
          {busy ? 'Asking Claude…' : 'Test connection'}
        </button>
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {reply && (
        <div className="mt-3 rounded-lg border border-purple-100 bg-purple-50/40 px-3 py-2">
          <p className="flex items-center gap-1 text-xs font-medium text-purple-700">
            <Sparkles size={12} aria-hidden="true" /> AI
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{reply.text}</p>
          <p className="mt-2 text-xs text-gray-500">
            <span className="font-mono">{reply.servedModel}</span>
            {' · '}{reply.inputTokens.toLocaleString('en-PH')} in / {reply.outputTokens.toLocaleString('en-PH')} out tokens
            {' · '}{formatUsd(reply.costUsd, 4)}
            {' · '}{(reply.durationMs / 1000).toFixed(1)} s
          </p>
        </div>
      )}
    </form>
  )
}
