'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { XCircle } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Field, inputClass, secondaryButtonClass } from '@/components/ui/form'

/**
 * Cancel with a reason (Week 5 Task 6, D5). The reason is required here for
 * fast feedback; the route and service require it too. Shown only for
 * statuses the service accepts, which the page decides.
 */
export function CancelProductionOrder({ productionOrderId, orderNumber }: { productionOrderId: string; orderNumber: string }) {
  const router = useRouter()
  const [open, setOpen]     = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)

  function close() {
    if (busy) return
    setOpen(false)
    setError(null)
  }

  async function cancelOrder(event: React.FormEvent) {
    event.preventDefault()
    if (reason.trim() === '') {
      setError('Give a reason, so the record says why this run was called off.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/production-orders/${productionOrderId}/cancel`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reason }),
      })
      const body = await response.json().catch(() => null)

      if (!response.ok) {
        setError(body?.error ?? `Request failed (${response.status})`)
        return
      }

      setOpen(false)
      router.refresh()
    } catch {
      setError('Could not reach the server')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700"
      >
        <XCircle size={15} />
        Cancel order
      </button>

      {open && (
        <Modal title={`Cancel ${orderNumber}`} onClose={close}>
          <form onSubmit={cancelOrder} className="space-y-4">
            <p className="text-sm text-gray-500">
              The order stops here and cannot be reopened. Anything it had committed is freed for other runs.
            </p>
            <Field label="Reason">
              <textarea
                rows={3}
                value={reason}
                onChange={event => setReason(event.target.value)}
                placeholder="e.g. Event postponed; pork blood unavailable this week"
                maxLength={500}
                className={inputClass}
                autoFocus
              />
            </Field>
            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={close} className={secondaryButtonClass}>Keep order</button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? 'Cancelling…' : 'Cancel order'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
