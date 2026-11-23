'use client'

import { useState } from 'react'
import { secondaryButtonClass } from '@/components/ui/form'

/**
 * "Email PDF" on a report page (Week 11 Task 7): the report on screen, as a
 * PDF, to me — or, for admin and accounting, to management. The query is the
 * page's own, so the email is what is shown.
 */
export function EmailReportButton({ reportKey, query, canSendToManagement }: {
  reportKey: string
  query: Record<string, string>
  canSendToManagement: boolean
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function send(recipients: 'me' | 'management') {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/reports/${reportKey}/email`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...query, recipients }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage({ ok: false, text: body?.error ?? `Could not send (${response.status})` })
        return
      }
      const missing: string[] = body?.withoutAddress ?? []
      setMessage(body?.queued > 0
        ? { ok: true, text: `Sending to ${body.queued} ${body.queued === 1 ? 'person' : 'people'} — it arrives in a minute.${missing.length > 0 ? ` No email address for ${missing.join(', ')}.` : ''}` }
        : { ok: false, text: recipients === 'me' ? 'You have no notification email — an admin sets it under Admin → Email.' : 'Nobody in management has a notification email.' })
      setOpen(false)
    } catch {
      setMessage({ ok: false, text: 'Could not reach the server.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(value => !value)} disabled={busy} className={`${secondaryButtonClass} disabled:opacity-50`}>
        {busy ? 'Sending…' : 'Email PDF'}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-48 overflow-hidden rounded-lg border border-gray-200 bg-white text-sm shadow-lg">
          <button type="button" onClick={() => send('me')} className="block w-full px-3 py-2 text-left text-gray-700 hover:bg-gray-50">To me</button>
          {canSendToManagement && (
            <button type="button" onClick={() => send('management')} className="block w-full px-3 py-2 text-left text-gray-700 hover:bg-gray-50">To management</button>
          )}
        </div>
      )}
      {message && (
        <p className={`absolute right-0 z-10 mt-1 w-72 rounded-lg border px-3 py-2 text-xs ${message.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}
