'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PackageCheck } from 'lucide-react'
import { primaryButtonClass } from '@/components/ui/form'

/**
 * The receiving branch confirms a transfer arrived (Week 8 Task 3, R3). For
 * now it takes everything dispatched (R4) — a different count is Task 4's
 * variance — so it asks before it posts. The server checks who may.
 */
export function ConfirmReceiptButton({ transferId, transferNumber, branchName }: {
  transferId: string
  transferNumber: string
  branchName: string
}) {
  const router = useRouter()
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!window.confirm(`Confirm everything on ${transferNumber} arrived at ${branchName}? It joins ${branchName}'s stock.`)) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/transfers/${transferId}/receive`, { method: 'POST' })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        setError(body?.error ?? `Request failed (${response.status})`)
        return
      }
      router.refresh()
    } catch {
      setError('Could not reach the server')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button type="button" onClick={confirm} disabled={busy} className={`${primaryButtonClass} inline-flex items-center gap-1.5`}>
        <PackageCheck size={16} /> {busy ? 'Confirming…' : 'Confirm received'}
      </button>
      {error && <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  )
}
