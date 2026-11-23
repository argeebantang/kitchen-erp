'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ApprovalInboxDto, ApprovalItemDto, ApprovalType } from '@/services/approval-inbox.service'
import { formatPeso } from '@/lib/format'
import { formatDateTime } from '@/lib/dates'

type Decision = 'APPROVED' | 'REJECTED'
type Filter = ApprovalType | 'ALL' | 'OVERDUE'

/** What was decided on this screen, newest first — shown above the queue so a run of decisions is visible. */
type LogEntry = { key: string; number: string; decision: Decision }

const LOG_LIMIT = 6
const HOUR_MS = 3_600_000

const FLAG_CLASSES: Record<ApprovalItemDto['flags'][number]['tone'], string> = {
  ok:   'bg-emerald-50 text-emerald-700',
  warn: 'bg-amber-50 text-amber-700',
  bad:  'bg-red-50 text-red-700',
}

/** "40 min", "5 h", "1 d 3 h". */
function waited(sinceIso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(sinceIso)) / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h`
  const days = Math.floor(hours / 24)
  return hours % 24 === 0 ? `${days} d` : `${days} d ${hours % 24} h`
}

function isOverdue(item: ApprovalItemDto, now: number, overdueHours: number): boolean {
  return item.pendingSince !== null && now - Date.parse(item.pendingSince) >= overdueHours * HOUR_MS
}

const keyOf = (item: Pick<ApprovalItemDto, 'type' | 'id'>) => `${item.type}:${item.id}`

/**
 * The unified approvals queue (Week 11 Task 1): every pending document,
 * oldest first, each decided in place — Approve in one click, Reject with the
 * reason typed in the same row. Decisions post to /api/approvals, whose
 * services re-check everything; a refusal (already decided, stock moved,
 * price missing) shows on the row.
 *
 * `now` comes from the server render so the ages match between server and
 * browser; the page's AutoRefresh moves it on every minute.
 */
export function ApprovalInbox({
  inbox,
  labels,
  overdueHours,
  now,
}: {
  inbox: ApprovalInboxDto
  labels: Record<ApprovalType, { one: string; many: string }>
  overdueHours: number
  now: number
}) {
  const router = useRouter()
  const [filter, setFilter] = useState<Filter>('ALL')
  // Hidden as soon as the decision lands, before the refresh removes it from the list.
  const [decided, setDecided] = useState<Set<string>>(new Set())
  const [log, setLog] = useState<LogEntry[]>([])

  const open = inbox.items.filter(item => !decided.has(keyOf(item)))
  const overdueCount = open.filter(item => isOverdue(item, now, overdueHours)).length
  const countOf = (type: ApprovalType) => open.filter(item => item.type === type).length
  const shown = open.filter(item =>
    filter === 'ALL' ? true
      : filter === 'OVERDUE' ? isOverdue(item, now, overdueHours)
        : item.type === filter)

  function onDecided(item: ApprovalItemDto, decision: Decision) {
    setDecided(previous => new Set(previous).add(keyOf(item)))
    setLog(previous => [{ key: `${keyOf(item)}:${Date.now()}`, number: item.number, decision }, ...previous].slice(0, LOG_LIMIT))
    router.refresh()
  }

  const chips: { value: Filter; label: string; count: number }[] = [
    { value: 'ALL', label: 'All', count: open.length },
    ...(overdueCount > 0 ? [{ value: 'OVERDUE' as const, label: `Over ${overdueHours} h`, count: overdueCount }] : []),
    ...(Object.keys(labels) as ApprovalType[])
      .filter(type => countOf(type) > 0)
      .map(type => ({ value: type, label: labels[type].many, count: countOf(type) })),
  ]

  return (
    <div>
      {log.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm">
          <span className="text-gray-500">Just decided:</span>
          {log.map(entry => (
            <span
              key={entry.key}
              className={`rounded px-1.5 py-0.5 font-mono text-xs ${entry.decision === 'APPROVED' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}
            >
              {entry.decision === 'APPROVED' ? '✓' : '✗'} {entry.number}
            </span>
          ))}
        </div>
      )}

      {open.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {chips.map(chip => (
            <button
              key={chip.value}
              type="button"
              onClick={() => setFilter(chip.value)}
              aria-pressed={filter === chip.value}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                filter === chip.value
                  ? 'border-orange-500 bg-orange-500 text-white'
                  : chip.value === 'OVERDUE'
                    ? 'border-red-200 bg-white text-red-700 hover:bg-red-50'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {chip.label} · {chip.count}
            </button>
          ))}
        </div>
      )}

      {open.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-gray-600">Inbox clear</p>
          <p className="mt-1 text-sm text-gray-400">Anything submitted for approval will appear here, oldest first.</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <p className="text-sm text-gray-500">Nothing left under this filter.</p>
          <button type="button" onClick={() => setFilter('ALL')} className="mt-2 text-sm font-medium text-orange-600 hover:underline">
            Show all
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {shown.map(item => (
            <InboxRow
              key={keyOf(item)}
              item={item}
              typeLabel={labels[item.type].one}
              overdue={isOverdue(item, now, overdueHours)}
              now={now}
              onDecided={decision => onDecided(item, decision)}
            />
          ))}
        </ul>
      )}

      {inbox.truncated && (
        <p className="mt-3 text-xs text-gray-400">
          Some kinds have more waiting than the inbox loads at once; their oldest are shown. Decide these and the rest appear.
        </p>
      )}
    </div>
  )
}

function InboxRow({
  item,
  typeLabel,
  overdue,
  now,
  onDecided,
}: {
  item: ApprovalItemDto
  typeLabel: string
  overdue: boolean
  now: number
  onDecided: (decision: Decision) => void
}) {
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState<Decision | null>(null)
  const [error, setError] = useState<string | null>(null)
  const remarksRef = useRef<HTMLInputElement>(null)

  async function decide(decision: Decision) {
    // Checked here for fast feedback; every service refuses a reasonless rejection too.
    if (decision === 'REJECTED' && remarks.trim() === '') {
      setError('Type the reason first — whoever submitted it needs to know what to change.')
      remarksRef.current?.focus()
      return
    }

    setBusy(decision)
    setError(null)
    try {
      const response = await fetch('/api/approvals', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ referenceType: item.type, referenceId: item.id, decision, remarks: remarks.trim() || null }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        setError(body?.error ?? `Request failed (${response.status})`)
        return
      }
      onDecided(decision)
    } catch {
      setError('Could not reach the server')
    } finally {
      setBusy(null)
    }
  }

  return (
    <li className={`grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_11rem_minmax(18rem,24rem)] lg:items-center ${overdue ? 'border-l-4 border-l-red-400' : 'border-l-4 border-l-transparent'}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-600">{typeLabel}</span>
          <Link href={item.href} className="font-mono text-orange-600 hover:text-orange-700 hover:underline">
            {item.number}
          </Link>
          {item.pendingSince && (
            <span className={overdue ? 'font-medium text-red-600' : 'text-gray-400'} title={`Submitted ${formatDateTime(item.pendingSince)}`}>
              waiting {waited(item.pendingSince, now)}
            </span>
          )}
        </div>
        <p className="mt-1 truncate text-sm font-medium text-gray-800" title={item.title}>{item.title}</p>
        <p className="text-xs text-gray-500">
          {[item.detail, item.branchName && !item.detail?.includes(item.branchName) ? item.branchName : null, item.submittedByName ? `by ${item.submittedByName}` : null]
            .filter(Boolean).join(' · ')}
        </p>
        {item.flags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {item.flags.map(flag => (
              <span key={flag.label} className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${FLAG_CLASSES[flag.tone]}`}>
                {flag.label}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="text-sm lg:text-right">
        {item.amount === null ? (
          <span className="text-gray-300">—</span>
        ) : (
          <>
            <span className="font-medium text-gray-800">{formatPeso(item.amount)}</span>
            {item.amountPer && <span className="text-gray-400">/{item.amountPer}</span>}
            <span className="block text-xs text-gray-400">{item.amountLabel}</span>
          </>
        )}
      </div>

      {item.mine ? (
        <p className="text-xs text-gray-400 lg:text-right">You submitted this — another approver decides it.</p>
      ) : (
        <div>
          <div className="flex gap-2">
            <input
              ref={remarksRef}
              value={remarks}
              onChange={event => setRemarks(event.target.value)}
              maxLength={1000}
              placeholder="Comment (needed to reject)"
              aria-label={`Comment on ${item.number}`}
              className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            <button
              type="button"
              onClick={() => decide('REJECTED')}
              disabled={busy !== null}
              className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              {busy === 'REJECTED' ? '…' : 'Reject'}
            </button>
            <button
              type="button"
              onClick={() => decide('APPROVED')}
              disabled={busy !== null}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy === 'APPROVED' ? '…' : 'Approve'}
            </button>
          </div>
          {error && <p className="mt-1.5 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
        </div>
      )}
    </li>
  )
}
