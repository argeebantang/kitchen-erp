'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import {
  Field, inputClass, primaryButtonClass, secondaryButtonClass,
} from '@/components/ui/form'
import { CATEGORY_TYPES } from '@/repositories/category.repository'
import type { CategoryDto, UnitDto } from '@/services/reference-data.service'

/**
 * Categories and units share a panel — both are small, flat reference lists
 * whose only operations are "list" and "add". Giving each its own bespoke
 * component would duplicate the same table twice over.
 */
export function ReferenceDataPanel({
  kind, categories, units,
}: {
  kind: 'categories' | 'units'
  categories: CategoryDto[]
  units: UnitDto[]
}) {
  const router = useRouter()

  const [creating, setCreating] = useState(false)
  const [error, setError]       = useState('')
  const [saving, setSaving]     = useState(false)
  const [name, setName]         = useState('')
  const [type, setType]         = useState<string>(CATEGORY_TYPES[0])
  const [abbreviation, setAbbr] = useState('')

  const isCategories = kind === 'categories'
  const rows         = isCategories ? categories : units

  function open() {
    setName('')
    setAbbr('')
    setType(CATEGORY_TYPES[0])
    setError('')
    setCreating(true)
  }

  async function save() {
    setSaving(true)
    setError('')

    const res = await fetch(isCategories ? '/api/categories' : '/api/units', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(isCategories ? { name, type } : { name, abbreviation }),
    })

    const data = await res.json()
    setSaving(false)

    if (!res.ok) {
      setError(data.error ?? 'Save failed')
      return
    }

    setCreating(false)
    router.refresh()
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-400">
          {rows.length} {isCategories ? 'categor' : 'unit'}{isCategories ? (rows.length === 1 ? 'y' : 'ies') : (rows.length === 1 ? '' : 's')}
        </p>
        <button
          onClick={open}
          className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
        >
          <Plus size={16} /> New {isCategories ? 'category' : 'unit'}
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">{isCategories ? 'Type' : 'Abbreviation'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr><td colSpan={2} className="px-4 py-10 text-center text-gray-400">Nothing yet.</td></tr>
            )}
            {isCategories
              ? categories.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-800">{c.name}</td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600">
                        {c.type}
                      </span>
                    </td>
                  </tr>
                ))
              : units.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-800">{u.name}</td>
                    <td className="px-4 py-3 text-gray-600">{u.abbreviation}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {creating && (
        <Modal
          title={`New ${isCategories ? 'category' : 'unit'}`}
          onClose={() => setCreating(false)}
        >
          {error && (
            <div className="mb-4 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="space-y-3">
            <Field label="Name">
              <input className={inputClass} value={name} onChange={e => setName(e.target.value)} />
            </Field>

            {isCategories ? (
              <Field label="Type">
                <select className={inputClass} value={type} onChange={e => setType(e.target.value)}>
                  {CATEGORY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            ) : (
              <Field label="Abbreviation">
                <input
                  className={inputClass}
                  value={abbreviation}
                  onChange={e => setAbbr(e.target.value)}
                  placeholder="kg"
                />
              </Field>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setCreating(false)} className={secondaryButtonClass}>Cancel</button>
              <button onClick={save} disabled={saving} className={primaryButtonClass}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
