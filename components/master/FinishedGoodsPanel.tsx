'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Pencil, Ban, ClipboardList, Loader2 } from 'lucide-react'
import { formatPeso, formatShelfLife } from '@/lib/format'
import { requestJson } from '@/lib/http'
import { Modal } from '@/components/ui/Modal'
import {
  Field, inputClass, primaryButtonClass, secondaryButtonClass,
} from '@/components/ui/form'
import type { FinishedGoodDto } from '@/services/finished-good.service'
import type { CategoryDto, UnitDto } from '@/services/reference-data.service'
import { SortHeader } from '@/components/ui/ListControls'
import { SearchBox } from '@/components/ui/SearchBox'
import type { ListSort, SearchParams } from '@/lib/list-query'
import type { FinishedGoodSortKey } from '@/services/finished-good.service'

type Props = {
  finishedGoods: FinishedGoodDto[]
  categories: CategoryDto[]
  units: UnitDto[]
  /** The service's MAX_SHELF_LIFE_HOURS, so the form can say it up front. */
  maxShelfLifeHours: number
  /** Server-side paging, search and sort (Week 12): the page's query, and how many rows match it. */
  list: { total: number; q: string; sort: ListSort<FinishedGoodSortKey>; params: SearchParams }
}

const emptyForm = {
  code: '', name: '', description: '', categoryId: '', unitId: '', sellingPrice: '0', shelfLifeHours: '',
}

export function FinishedGoodsPanel({ finishedGoods, categories, units, maxShelfLifeHours, list }: Props) {
  const router = useRouter()

  const [creating, setCreating] = useState(false)
  const [editing, setEditing]   = useState<FinishedGoodDto | null>(null)
  const [form, setForm]         = useState(emptyForm)
  const [error, setError]       = useState('')
  const [saving, setSaving]     = useState(false)
  // Deactivate runs from the table, outside any modal, so its failure shows above the table.
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null)
  const [listError, setListError]           = useState('')

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
      shelfLifeHours: good.shelfLifeHours === null ? '' : String(good.shelfLifeHours),
    })
    setError('')
    setEditing(good)
  }

  function close() {
    setCreating(false)
    setEditing(null)
  }

  async function save() {
    // Blank means not set yet. The server re-checks; this is for the person typing.
    const shelfLife = form.shelfLifeHours.trim()
    if (shelfLife !== '' && !(/^\d+$/.test(shelfLife) && Number(shelfLife) >= 1 && Number(shelfLife) <= maxShelfLifeHours)) {
      setError(`Shelf life must be a whole number of hours from 1 to ${maxShelfLifeHours}, or blank.`)
      return
    }

    setSaving(true)
    setError('')

    const isEdit = editing !== null
    const body = {
      name:         form.name,
      description:  form.description || null,
      categoryId:   form.categoryId,
      unitId:       form.unitId,
      sellingPrice: form.sellingPrice,
      shelfLifeHours: shelfLife === '' ? null : Number(shelfLife),
      ...(isEdit ? {} : { code: form.code }),
    }

    const result = await requestJson(isEdit ? `/api/finished-goods/${editing.id}` : '/api/finished-goods', {
      method: isEdit ? 'PATCH' : 'POST',
      body,
      fields: {
        code: 'Code', name: 'Name', description: 'Description', categoryId: 'Category', unitId: 'Unit',
        sellingPrice: 'Selling price', shelfLifeHours: 'Shelf life',
      },
    })
    setSaving(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    close()
    router.refresh()
  }

  async function deactivate(good: FinishedGoodDto) {
    setDeactivatingId(good.id)
    setListError('')
    const result = await requestJson(`/api/finished-goods/${good.id}`, { method: 'DELETE' })
    setDeactivatingId(null)
    if (!result.ok) {
      setListError(`Could not deactivate ${good.name}: ${result.error}`)
      return
    }
    router.refresh()
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <SearchBox placeholder="Search code or name" />
          <p className="text-sm text-gray-400">
            {list.total} active finished good{list.total === 1 ? '' : 's'}{list.q ? ' match' : ''}
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
        >
          <Plus size={16} /> New finished good
        </button>
      </div>

      {listError && (
        <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">
          {listError}
          <button type="button" onClick={() => setListError('')} className="text-xs font-medium text-red-700 hover:underline">Dismiss</button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <SortHeader label="Code" sortKey="code" {...{ sort: list.sort, path: '/admin/master', params: list.params }} />
              <SortHeader label="Name" sortKey="name" {...{ sort: list.sort, path: '/admin/master', params: list.params }} />
              <SortHeader label="Category" sortKey="category" {...{ sort: list.sort, path: '/admin/master', params: list.params }} />
              <SortHeader label="Unit" sortKey="unit" {...{ sort: list.sort, path: '/admin/master', params: list.params }} />
              <SortHeader label="Selling price" sortKey="price" firstDir="desc" align="right" {...{ sort: list.sort, path: '/admin/master', params: list.params }} />
              <SortHeader label="Shelf life" sortKey="shelfLife" {...{ sort: list.sort, path: '/admin/master', params: list.params }} />
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {finishedGoods.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                  {list.q ? `No finished goods match \u201c${list.q}\u201d. The search looks at every page.` : 'No finished goods yet.'}
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
                <td className="px-4 py-3 text-gray-600">
                  {/* Needed before a run of it can be approved (Week 6 Task 4). */}
                  {good.shelfLifeHours === null
                    ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">Not set</span>
                    : formatShelfLife(good.shelfLifeHours)}
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
                      disabled={deactivatingId === good.id}
                      className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-wait disabled:opacity-50"
                    >
                      {deactivatingId === good.id ? <Loader2 size={15} className="animate-spin" /> : <Ban size={15} />}
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

            <Field label="Shelf life (hours)">
              <input
                className={inputClass}
                value={form.shelfLifeHours}
                onChange={e => setForm({ ...form, shelfLifeHours: e.target.value })}
                inputMode="numeric"
                placeholder="e.g. 72 for 3 days"
              />
              <p className="mt-1 text-xs text-gray-500">
                How long it keeps once cooked, 1–{maxShelfLifeHours} hours. Each lot expires this long after its run is
                reported done; a run cannot be approved until this is set.
              </p>
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
