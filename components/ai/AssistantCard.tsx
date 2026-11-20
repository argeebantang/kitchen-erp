'use client'

import { useEffect, useRef, useState } from 'react'
import { Send, Sparkles } from 'lucide-react'
import type { AssistantAnswerDto, AssistantMessage } from '@/services/assistant.service'
import { formatUsd } from '@/lib/format'
import { primaryButtonClass } from '@/components/ui/form'

type Turn =
  | { role: 'user'; content: string }
  | ({ role: 'assistant'; content: string } & Pick<AssistantAnswerDto, 'lookups' | 'costUsd'>)

const EXAMPLES = [
  'Magkano ang gastos namin ngayong buwan?',
  'How many users do we have?',
  'Ano ang ibig sabihin ng yield?',
]

/**
 * The dashboard assistant (Week 9 Task 3, F5). The conversation lives here,
 * in the page: each question is sent with the last `history` messages so a
 * follow-up has its context; the server logs each question for admins
 * (Week 9 Task 4) but keeps no conversation state. A failed question is not
 * added; it goes back into the box to try again.
 */
export function AssistantCard({ maxLength, history }: { maxLength: number; history: number }) {
  const [turns, setTurns]       = useState<Turn[]>([])
  const [question, setQuestion] = useState('')
  const [pending, setPending]   = useState<string | null>(null)
  const [error, setError]       = useState<string | null>(null)
  // Issued by the server with the first answer and sent back with follow-ups,
  // so the query log keeps a conversation together (Week 9 Task 4, H4).
  const [conversationId, setConversationId] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [turns, pending])

  async function ask(text: string) {
    const asked = text.trim()
    if (asked === '' || pending !== null) return

    const messages: AssistantMessage[] = [
      ...turns.slice(-history).map(({ role, content }) => ({ role, content })),
      { role: 'user', content: asked },
    ]
    setPending(asked)
    setQuestion('')
    setError(null)
    try {
      const response = await fetch('/api/ai/assistant', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ messages, conversationId }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || !body) {
        setError(body?.error ?? 'The assistant could not answer.')
        setQuestion(asked)
        return
      }
      const answer: AssistantAnswerDto = body
      setConversationId(answer.conversationId)
      setTurns(previous => [
        ...previous,
        { role: 'user', content: asked },
        { role: 'assistant', content: answer.answer, lookups: answer.lookups, costUsd: answer.costUsd },
      ])
    } catch {
      setError('Could not reach the server.')
      setQuestion(asked)
    } finally {
      setPending(null)
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter asks; Shift+Enter is a new line.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void ask(question)
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
          <Sparkles size={16} className="text-purple-600" aria-hidden="true" /> Ask KitchenAI
        </p>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={() => { setTurns([]); setError(null); setConversationId(null) }}
            disabled={pending !== null}
            className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            New conversation
          </button>
        )}
      </div>
      <p className="mt-0.5 text-xs text-gray-400">In English, Filipino or Taglish. Answers come from the system&apos;s own data.</p>

      {(turns.length > 0 || pending !== null) && (
        <div className="mt-3 max-h-96 space-y-3 overflow-y-auto">
          {turns.map((turn, index) => turn.role === 'user' ? (
            <div key={index} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-orange-50 px-3 py-2 text-sm text-gray-800">{turn.content}</p>
            </div>
          ) : (
            <div key={index} className="max-w-[85%] rounded-lg border border-purple-100 bg-purple-50/40 px-3 py-2">
              <p className="whitespace-pre-wrap text-sm text-gray-800">{turn.content}</p>
              <p className="mt-1.5 text-xs text-gray-400">
                {turn.lookups.length > 0 && <>Looked up: {turn.lookups.map(lookup => lookup.label).join(' · ')} · </>}
                {formatUsd(turn.costUsd, 4)}
              </p>
              {/* F3: the SQL Claude wrote, so an answer from run_query can be checked. */}
              {turn.lookups.some(lookup => lookup.query !== null) && (
                <details className="mt-1.5 text-xs text-gray-500">
                  <summary className="cursor-pointer select-none text-purple-700 hover:underline">How I got this</summary>
                  <div className="mt-1.5 space-y-2">
                    {turn.lookups.map((lookup, lookupIndex) => lookup.query && (
                      <div key={lookupIndex}>
                        <p>
                          {lookup.label}: {lookup.query.rowCount} {lookup.query.rowCount === 1 ? 'row' : 'rows'}
                          {lookup.query.truncated && ' (more matched; only these were used)'}
                        </p>
                        <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap rounded border border-gray-200 bg-white p-2 font-mono text-[11px] text-gray-700">{lookup.query.sql}</pre>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ))}
          {pending !== null && (
            <>
              <div className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-orange-50 px-3 py-2 text-sm text-gray-800">{pending}</p>
              </div>
              <p className="flex items-center gap-2 text-sm text-purple-700">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-purple-300 border-t-purple-700" aria-hidden="true" />
                Thinking…
              </p>
            </>
          )}
          <div ref={endRef} />
        </div>
      )}

      {turns.length === 0 && pending === null && (
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map(example => (
            <button
              key={example}
              type="button"
              onClick={() => void ask(example)}
              className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <form onSubmit={event => { event.preventDefault(); void ask(question) }} className="mt-3 flex gap-2">
        <textarea
          aria-label="Your question"
          rows={1}
          className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400"
          placeholder="Ask about costs, stock, orders…"
          value={question}
          maxLength={maxLength}
          onChange={event => setQuestion(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={pending !== null}
        />
        <button type="submit" className={`${primaryButtonClass} inline-flex items-center gap-1.5`} disabled={pending !== null || question.trim() === ''}>
          <Send size={14} aria-hidden="true" /> Ask
        </button>
      </form>
    </div>
  )
}
