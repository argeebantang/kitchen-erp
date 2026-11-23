'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { secondaryButtonClass } from '@/components/ui/form'

/**
 * Admin → Email (Week 11 Task 2): one real email to your own notification
 * address. Refreshes the page afterwards — it is logged sent, skipped or failed.
 */
export function SendTestEmail() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  async function send() {
    setBusy(true)
    setResult(null)
    try {
      const response = await fetch('/api/email/test', { method: 'POST' })
      const body = await response.json().catch(() => null)
      setResult(response.ok
        ? { ok: true, text: `Sent to ${body?.sentTo ?? 'your address'} — check the inbox (and spam).` }
        : { ok: false, text: body?.error ?? `The test failed (${response.status}).` })
    } catch {
      setResult({ ok: false, text: 'Could not reach the server.' })
    } finally {
      setBusy(false)
      router.refresh()
    }
  }

  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <button type="button" onClick={send} disabled={busy} className={`${secondaryButtonClass} disabled:opacity-50`}>
        {busy ? 'Sending…' : 'Send a test email to me'}
      </button>
      {result && (
        <p className={`mt-2 rounded-lg border px-3 py-2 text-sm ${result.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {result.text}
        </p>
      )}
    </div>
  )
}
