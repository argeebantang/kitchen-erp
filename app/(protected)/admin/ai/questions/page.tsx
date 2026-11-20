import Link from 'next/link'
import { formatDateTime } from '@/lib/dates'
import { formatUsd } from '@/lib/format'
import { inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'
import { AI_QUERY_PAGE_SIZE, AiQueryService, type AiQueryDto } from '@/services/ai-query.service'

type PageProps = {
  searchParams: Promise<{ user?: string; conversation?: string; page?: string }>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const STATUS_STYLE: Record<AiQueryDto['status'], string> = {
  ANSWERED: 'bg-emerald-50 text-emerald-700',
  FAILED:   'bg-red-50 text-red-700',
  PENDING:  'bg-amber-50 text-amber-700',
}

function seconds(ms: number | null): string {
  return ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`
}

/**
 * Assistant questions (Week 9 Task 4, H7): the query log — every question
 * asked of the dashboard assistant, who asked it, what was looked up and what
 * was answered. ADMIN only (the /admin guard in middleware).
 */
export default async function AssistantQuestionsPage({ searchParams }: PageProps) {
  const { user: userParam = '', conversation: conversationParam = '', page: pageParam } = await searchParams
  const page = Math.max(1, Number.parseInt(pageParam ?? '1', 10) || 1)
  const conversationId = UUID.test(conversationParam) ? conversationParam : undefined

  // A malformed conversation id is ignored; an unknown user simply matches nothing.
  const userId = userParam || undefined
  const { questions, total, askers } = await AiQueryService.list({ userId, conversationId, page })
  const pageCount = Math.max(1, Math.ceil(total / AI_QUERY_PAGE_SIZE))
  const filtered = userId !== undefined || conversationId !== undefined

  const href = (target: { page?: number; conversation?: string | null }) => {
    const query = new URLSearchParams()
    if (userId) query.set('user', userId)
    const conversation = target.conversation === undefined ? conversationId : target.conversation
    if (conversation) query.set('conversation', conversation)
    if (target.page && target.page > 1) query.set('page', String(target.page))
    const text = query.toString()
    return text ? `/admin/ai/questions?${text}` : '/admin/ai/questions'
  }

  return (
    <div>
      <div className="mb-6">
        <Link href="/admin/ai" className="text-sm text-gray-400 hover:text-gray-600">← AI Settings</Link>
        <h1 className="mt-1 text-2xl font-bold text-gray-800">Assistant questions</h1>
        <p className="mt-1 text-sm text-gray-400">
          Every question asked of the dashboard assistant: who asked, what it looked up, and what it answered.
          Query results are not kept — only the queries.
        </p>
      </div>

      {/* A GET form: the filters live in the URL, so a filtered list can be linked to. */}
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <label className="block min-w-56">
          <span className="mb-1 block text-xs font-medium text-gray-500">Asked by</span>
          <select name="user" defaultValue={userId ?? ''} className={inputClass}>
            <option value="">Everyone</option>
            {askers.map(asker => <option key={asker.id} value={asker.id}>{asker.name}</option>)}
          </select>
        </label>
        {conversationId && <input type="hidden" name="conversation" value={conversationId} />}
        <button type="submit" className={primaryButtonClass}>Apply</button>
        {filtered && <Link href="/admin/ai/questions" className={secondaryButtonClass}>Clear</Link>}
      </form>

      {conversationId && (
        <p className="mb-4 text-sm text-gray-500">
          Showing one conversation, in the order it was asked ·{' '}
          <Link href={href({ conversation: null })} className="text-orange-600 hover:underline">show all</Link>
        </p>
      )}

      {questions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-gray-600">{filtered ? 'No questions match these filters' : 'No questions yet'}</p>
          <p className="mt-1 text-sm text-gray-400">Questions appear here as people ask the assistant on the Dashboard.</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {questions.map(question => (
            <li key={question.id}>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 hover:bg-gray-50">
                  <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[question.status]}`}>
                    {question.status.toLowerCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-gray-800 group-open:whitespace-normal">{question.question}</span>
                    <span className="block text-xs text-gray-400">
                      {question.userName} · {formatDateTime(question.createdAt)}
                      {question.lookups.length > 0 && ` · ${question.lookups.length} ${question.lookups.length === 1 ? 'lookup' : 'lookups'}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs tabular-nums text-gray-500">
                    {formatUsd(question.costUsd, 4)}
                    <span className="block text-gray-400">{question.rounds} {question.rounds === 1 ? 'round' : 'rounds'} · {seconds(question.durationMs)}</span>
                  </span>
                </summary>

                <div className="space-y-3 border-t border-gray-100 bg-gray-50/60 px-4 py-3 text-sm">
                  {question.answer !== null && (
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Answer</p>
                      <p className="mt-1 whitespace-pre-wrap text-gray-800">{question.answer}</p>
                    </div>
                  )}
                  {question.error !== null && (
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Shown to the user</p>
                      <p className="mt-1 text-red-700">{question.error}</p>
                    </div>
                  )}
                  {question.status === 'PENDING' && (
                    <p className="text-amber-700">Still pending: being answered now, or the server stopped before it finished.</p>
                  )}

                  {question.lookups.length > 0 && (
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Lookups, in order</p>
                      <ol className="mt-1 space-y-2">
                        {question.lookups.map((lookup, index) => (
                          <li key={index} className="rounded-lg border border-gray-200 bg-white p-2">
                            <p className="text-xs text-gray-600">
                              <span className="font-mono">{lookup.tool}</span>
                              {lookup.label && <> · {lookup.label}</>}
                              {lookup.rowCount !== null && <> · {lookup.rowCount} {lookup.rowCount === 1 ? 'row' : 'rows'}{lookup.truncated ? ' (cut off)' : ''}</>}
                            </p>
                            {lookup.error && <p className="mt-1 text-xs text-red-700">{lookup.error}</p>}
                            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-gray-700">{lookup.sql ?? lookup.input}</pre>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  <p className="text-xs text-gray-400">
                    {conversationId
                      ? <>Conversation {question.conversationId.slice(0, 8)}</>
                      : <Link href={href({ conversation: question.conversationId })} className="text-orange-600 hover:underline">Show this conversation</Link>}
                  </p>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}

      {pageCount > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
          <span>Page {page} of {pageCount} · {total} questions</span>
          <div className="flex gap-2">
            {page > 1 && <Link href={href({ page: page - 1 })} className={secondaryButtonClass}>Newer</Link>}
            {page < pageCount && <Link href={href({ page: page + 1 })} className={secondaryButtonClass}>Older</Link>}
          </div>
        </div>
      )}
    </div>
  )
}
