'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, Trash2 } from 'lucide-react'
import type { MaterialDto } from '@/services/material.service'
import {
  Field,
  IconButton,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '@/components/ui/form'
import { formatPeso } from '@/lib/format'
import { useRouter } from 'next/navigation'

type Line = {
  key: string
  materialId: string
  quantity: string
}

// A plain counter, not crypto.randomUUID(): this component also renders on the
// server for the initial HTML, and a random key would differ between the server
// and browser renders — React reports that as a hydration mismatch.
let nextKey = 0

function emptyLine(): Line {
  return { key: String(nextKey++), materialId: '', quantity: '' }
}

export function PurchaseRequestForm({ materials }: { materials: MaterialDto[] }) {
  const [neededBy, setNeededBy] = useState('')
  const [notes, setNotes]       = useState('')
  const [lines, setLines]       = useState<Line[]>([emptyLine()])

  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState<string | null>(null)

  const materialById = new Map(materials.map(material => [material.id, material]))

  function updateLine(key: string, patch: Partial<Line>) {
    setLines(current => current.map(line => (line.key === key ? { ...line, ...patch } : line)))
  }

  // Display-only estimate so the requester sees a running total while typing.
  // Number() is acceptable here and nowhere else — the authoritative figure is
  // recalculated server-side in Decimal. See the note in lib/format.ts.
  function lineTotal(line: Line): number | null {
    const price = materialById.get(line.materialId)?.currentPrice
    if (!price || !line.quantity) return null
    return Number(price) * Number(line.quantity)
  }

  const estimatedTotal = lines.reduce((sum, line) => sum + (lineTotal(line) ?? 0), 0)

   async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    // Only complete lines are sent. requestedById is deliberately absent — the
    // server takes it from the x-user-id header middleware injected, so nobody
    // can raise a request in someone else's name by editing the payload.
    const filled     = lines.filter(line => line.materialId || line.quantity)
    const incomplete = filled.filter(line => !line.materialId || !line.quantity)

    if (incomplete.length > 0) {
      setError('Every line needs both a material and a quantity. Remove any line you do not want.')
      setSubmitting(false)
      return
    }

    if (filled.length === 0) {
      setError('Add at least one line.')
      setSubmitting(false)
      return
    }

    const payload = {
      neededBy: neededBy || null,
      notes:    notes || null,
      items: filled.map(line => ({ materialId: line.materialId, quantity: line.quantity })),
    }

    try {
      const response = await fetch('/api/purchase-requests', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })

      const body = await response.json().catch(() => null)

      if (!response.ok) {
        setError(body?.error ?? `Request failed (${response.status})`)
        return
      }

      // refresh() re-runs the Server Components behind /procurement/requests so
      // the list reflects the new row. Without it you'd navigate to a cached page.
      router.push('/procurement/requests')
      router.refresh()
    } catch {
      setError('Could not reach the server')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Needed by">
          <input
            type="date"
            value={neededBy}
            onChange={event => setNeededBy(event.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Notes">
        <textarea
          rows={2}
          value={notes}
          onChange={event => setNotes(event.target.value)}
          placeholder="What is this for?"
          className={inputClass}
        />
      </Field>

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <p className="text-sm font-medium text-gray-700">Lines</p>
          <button
            type="button"
            onClick={() => setLines(current => [...current, emptyLine()])}
            className="flex items-center gap-1.5 text-sm font-medium text-orange-600 hover:text-orange-700"
          >
            <Plus size={15} />
            Add line
          </button>
        </div>

        <div className="divide-y divide-gray-100">
          {lines.map(line => {
            const material = materialById.get(line.materialId)
            const total = lineTotal(line)

            return (
              <div key={line.key} className="flex items-end gap-3 px-4 py-3">
                <div className="flex-1">
                  <Field label="Material">
                    <select
                      value={line.materialId}
                      onChange={event => updateLine(line.key, { materialId: event.target.value })}
                      className={inputClass}
                    >
                      <option value="">Select a material…</option>
                      {materials.map(option => (
                        <option key={option.id} value={option.id}>
                          {option.code} — {option.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <div className="w-32">
                  <Field label={`Quantity${material ? ` (${material.unitAbbreviation})` : ''}`}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={line.quantity}
                      onChange={event => updateLine(line.key, { quantity: event.target.value })}
                      placeholder="0"
                      className={inputClass}
                    />
                  </Field>
                </div>

                <div className="w-28 pb-2 text-right text-sm text-gray-600">
                  {total === null
                    ? <span className="text-gray-300">—</span>
                    : formatPeso(String(total))}
                </div>

                <div className="pb-1.5">
                  <IconButton
                    title="Remove line"
                    onClick={() => setLines(current => current.filter(l => l.key !== line.key))}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
          <span className="text-sm text-gray-500">Estimated total</span>
          <span className="text-sm font-semibold text-gray-800">
            {formatPeso(String(estimatedTotal))}
          </span>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={submitting} className={primaryButtonClass}>
          {submitting ? 'Saving…' : 'Save draft'}
        </button>
        <Link href="/procurement/requests" className={secondaryButtonClass}>Cancel</Link>
      </div>
    </form>
  )
}