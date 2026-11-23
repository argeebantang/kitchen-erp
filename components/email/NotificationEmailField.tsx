'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * One user's notification address on Admin → Email (Week 11 Task 2): edit and
 * Save; empty stops their emails. The login email is not touched.
 */
export function NotificationEmailField({ userId, name, initial }: { userId: string; name: string; initial: string | null }) {
  const router = useRouter()
  const [value, setValue] = useState(initial ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const changed = value.trim().toLowerCase() !== (initial ?? '')

  async function save() {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const response = await fetch(`/api/email/recipients/${encodeURIComponent(userId)}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ notificationEmail: value.trim() }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        setError(body?.fields?.notificationEmail?.[0] ?? body?.error ?? `Save failed (${response.status})`)
        return
      }
      setSaved(true)
      router.refresh()
    } catch {
      setError('Could not reach the server')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          type="email"
          value={value}
          onChange={event => { setValue(event.target.value); setSaved(false) }}
          placeholder="No emails"
          aria-label={`Notification email for ${name}`}
          className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400"
        />
        <button
          type="button"
          onClick={save}
          disabled={busy || !changed}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40"
        >
          {busy ? '…' : 'Save'}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {saved && !changed && <p className="mt-1 text-xs text-emerald-600">Saved</p>}
    </div>
  )
}
