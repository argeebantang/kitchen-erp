'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { inputClass, secondaryButtonClass } from '@/components/ui/form'
// Type-only, so nothing from the service is bundled into the browser.
import type { LeadTimeSource, SupplierDto } from '@/services/supplier.service'

const SOURCE_LABELS: Record<LeadTimeSource, string> = {
  measured: 'measured',
  promised: 'promised',
  default:  'default — set a promised one',
}

/**
 * Master Data → Suppliers (Week 10 Task 3): each supplier's lead time — what
 * it promises (editable), what its deliveries show, and which of the two a
 * reorder plans with. Adding and editing suppliers themselves is not here yet.
 */
export function SuppliersPanel({ suppliers }: { suppliers: SupplierDto[] }) {
  if (suppliers.length === 0) {
    return <p className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center text-sm text-gray-500">No suppliers yet.</p>
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-3 font-medium">Supplier</th>
            <th className="px-4 py-3 font-medium">Contact</th>
            <th className="px-4 py-3 font-medium">Promised lead time</th>
            <th className="px-4 py-3 font-medium">Measured</th>
            <th className="px-4 py-3 font-medium">Reorders plan with</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {suppliers.map(supplier => <SupplierRow key={supplier.id} supplier={supplier} />)}
        </tbody>
      </table>
      <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400">
        Measured: the median days from an approved order to its first delivery over the last 180 days, used once a supplier
        has 3 delivered orders. Otherwise the promised lead time, or 2 days.
      </p>
    </div>
  )
}

function SupplierRow({ supplier }: { supplier: SupplierDto }) {
  const router = useRouter()
  const { leadTime } = supplier
  const [value, setValue] = useState(leadTime.promisedDays === null ? '' : String(leadTime.promisedDays))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const unchanged = value.trim() === (leadTime.promisedDays === null ? '' : String(leadTime.promisedDays))

  async function save() {
    setError(null)
    const trimmed = value.trim()
    if (trimmed !== '' && !/^\d+$/.test(trimmed)) {
      setError('Whole days, or empty')
      return
    }
    setSaving(true)
    try {
      const response = await fetch(`/api/suppliers/${supplier.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ leadTimeDays: trimmed === '' ? null : Number(trimmed) }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        setError(body?.error ?? 'Could not save')
        return
      }
      router.refresh()
    } catch {
      setError('Could not reach the server')
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr className="align-top">
      <td className="px-4 py-3 text-gray-800">
        {supplier.name}
        {!supplier.isActive && <span className="ml-1 rounded bg-gray-100 px-1 text-xs text-gray-500">inactive</span>}
      </td>
      <td className="px-4 py-3 text-gray-500">{[supplier.contactName, supplier.phone].filter(Boolean).join(' · ') || '—'}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-20">
            <input
              type="text"
              inputMode="numeric"
              value={value}
              onChange={event => setValue(event.target.value)}
              placeholder="—"
              className={inputClass}
              aria-label={`${supplier.name} promised lead time in days`}
            />
          </div>
          <span className="text-xs text-gray-500">days</span>
          <button type="button" onClick={save} disabled={saving || unchanged} className={`${secondaryButtonClass} px-3 py-1.5 text-sm`}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      </td>
      <td className="px-4 py-3 text-gray-700">
        {leadTime.measuredDays === null
          ? <span className="text-gray-400">no deliveries yet</span>
          : <>{leadTime.measuredDays} days <span className="text-xs text-gray-400">over {leadTime.measuredOrders} orders</span></>}
      </td>
      <td className="px-4 py-3 text-gray-800">
        {leadTime.days} days <span className="text-xs text-gray-500">({SOURCE_LABELS[leadTime.source]})</span>
      </td>
    </tr>
  )
}
