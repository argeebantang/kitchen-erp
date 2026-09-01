'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Pencil, Ban, ClipboardList } from 'lucide-react'
import { formatPeso } from '@/lib/format'
import { Modal } from '@/components/ui/Modal'
import {
  Field, inputClass, primaryButtonClass, secondaryButtonClass,
} from '@/components/ui/form'
import type { FinishedGoodDto } from '@/services/finished-good.service'
import type { CategoryDto, UnitDto } from '@/services/reference-data.service'

type Props = {
  finishedGoods: FinishedGoodDto[]
  categories: CategoryDto[]
  units: UnitDto[]
}

const emptyForm = {
  code: '', name: '', description: '', categoryId: '', unitId: '', sellingPrice: '0',
}

export function FinishedGoodsPanel({ finishedGoods, categories, units }: Props) {
  const router = useRouter()

  const [creating, setCreating] = useState(false)
  const [editing, setEditing]   = useState<FinishedGoodDto | null>(null)
  const [form, setForm]         = useState(emptyForm)
  const [error, setError]       = useState('')
  const [saving, setSaving]     = useState(false)

  function openCreate() {
    setForm({ ...emptyForm, categoryId: categories[0]?.id ?? '', unitId: units[0]?.id ?? '' })
    setError('')
    setCreating(true)
  }

  function openEdit(good: FinishedGoodDto) {
    setForm({
      code:         good.code,
      name:         good.name,
      description:  good.description ?? '',
      categoryId:   good.categoryId,
      unitId:       good.unitId,
      sellingPrice: good.sellingPrice,
    })
    setError('')
    setEditing(good)
  }

  function close() {
    setCreating(false)
    setEditing(null)
  }

  async function save() {
    setSaving(true)
    setError('')

    const isEdit = editing !== null
    const body = {
      name:         form.name,
      description:  form.description || null,
      categoryId:   form.categoryId,
      unitId:       form.unitId,
      sellingPrice: form.sellingPrice,
      ...(isEdit ? {} : { code: form.code }),
    }

    const res = await fetch(isEdit ? `/api/finished-goods/${editing.id}` : '/api/finished-goods', {
      method:  isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })

    const data = await res.json()
    setSaving(false)

    if (!res.ok) {
      setError(data.error ?? 'Save failed')
      return
    }

    close()
    router.refresh()
  }

  async function deactivate(good: FinishedGoodDto) {
    await fetch(`/api/finished-goods/${good.id}`, { method: 'DELETE' })
    router.refresh()
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-400">
          {finishedGoods.length} active finished good{finishedGoods.length === 1 ? '' : 's'}
        </p>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
        >
          <Plus size={16} /> New finished good
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Unit</th>
              <th className="px-4 py-3 text-right font-medium">Selling price</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {finishedGoods.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                  No finished goods yet.
                </td>
              </tr>
            )}
            {finishedGoods.map(good => (
              <tr key={good.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{good.code}</td>
                <td className="px-4 py-3 font-medium text-gray-800">{good.name}</td>
                <td className="px-4 py-3 text-gray-600">{good.categoryName}</td>
                <td className="px-4 py-3 text-gray-600">{good.unitAbbreviation}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-800">
                  {formatPeso(good.sellingPrice)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Link
                      href={`/production/bom?finishedGoodId=${good.id}`}
                      title="View BOM"
                      className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                    >
                      <ClipboardList size={15} />
                    </Link>
                    <button
                      title="Edit"
                      onClick={() => openEdit(good)}
                      className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      title="Deactivate"
                      onClick={() => deactivate(good)}
                      className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                    >
                      <Ban size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(creating || editing) && (
        <Modal title={editing ? `Edit ${editing.name}` : 'New finished good'} onClose={close}>
          {error && (
            <div className="mb-4 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="space-y-3">
            {!editing && (
              <Field label="Code">
                <input
                  className={inputClass}
                  value={form.code}
                  onChange={e => setForm({ ...form, code: e.target.value })}
                  placeholder="FG-DINUGUAN"
                />
              </Field>
            )}

            <Field label="Name">
              <input
                className={inputClass}
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
              />
            </Field>

            <Field label="Description">
              <input
                className={inputClass}
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <select
                  className={inputClass}
                  value={form.categoryId}
                  onChange={e => setForm({ ...form, categoryId: e.target.value })}
                >
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>

              <Field label="Unit">
                <select
                  className={inputClass}
                  value={form.unitId}
                  onChange={e => setForm({ ...form, unitId: e.target.value })}
                >
                  {units.map(u => <option key={u.id} value={u.id}>{u.abbreviation}</option>)}
                </select>
              </Field>
            </div>

            <Field label="Selling price">
              <input
                className={inputClass}
                value={form.sellingPrice}
                onChange={e => setForm({ ...form, sellingPrice: e.target.value })}
                inputMode="decimal"
              />
            </Field>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={close} className={secondaryButtonClass}>Cancel</button>
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
