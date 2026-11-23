'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, History, Ban, Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import {
  Field, IconButton, inputClass, primaryButtonClass, secondaryButtonClass,
} from '@/components/ui/form'
import { trimDecimal, formatPeso } from '@/lib/format'
import { requestJson } from '@/lib/http'
import type { MaterialDto } from '@/services/material.service'
import type { CategoryDto, UnitDto } from '@/services/reference-data.service'
import { SortHeader } from '@/components/ui/ListControls'
import { SearchBox } from '@/components/ui/SearchBox'
import type { ListSort, SearchParams } from '@/lib/list-query'
import type { MaterialSortKey } from '@/services/material.service'

type Props = {
  materials: MaterialDto[]
  categories: CategoryDto[]
  units: UnitDto[]
  suppliers: { id: string; name: string }[]
  /** Server-side paging, search and sort (Week 12): the page's query, and how many rows match it. */
  list: { total: number; q: string; sort: ListSort<MaterialSortKey>; params: SearchParams }
}

type PriceRow = {
  id: string
  unitPrice: string
  effectiveDate: string
  supplierName: string | null
  note: string | null
}

// Labels for a 400 "Validation failed" — the API names the fields as in the body.
const FIELD_LABELS = {
  code: 'Code', name: 'Name', description: 'Description', categoryId: 'Category', unitId: 'Unit', reorderPoint: 'Reorder point',
}

const emptyForm = {
  code: '', name: '', description: '', categoryId: '', unitId: '', reorderPoint: '0',
}

export function MaterialsPanel({ materials, categories, units, suppliers, list }: Props) {
  const router = useRouter()

  const [editing, setEditing]   = useState<MaterialDto | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm]         = useState(emptyForm)
  const [error, setError]       = useState('')
  const [saving, setSaving]     = useState(false)
  // Deactivate runs from the table, outside any modal, so its failure shows above the table.
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null)
  const [listError, setListError]           = useState('')

  const [pricingFor, setPricingFor] = useState<MaterialDto | null>(null)

  function openCreate() {
    setForm({ ...emptyForm, categoryId: categories[0]?.id ?? '', unitId: units[0]?.id ?? '' })
    setError('')
    setCreating(true)
  }

  function openEdit(material: MaterialDto) {
    setForm({
      code:         material.code,
      name:         material.name,
      description:  material.description ?? '',
      categoryId:   material.categoryId,
      unitId:       material.unitId,
      reorderPoint: material.reorderPoint,
    })
    setError('')
    setEditing(material)
  }

  function closeForm() {
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
      reorderPoint: form.reorderPoint,
      ...(isEdit ? {} : { code: form.code }),
    }

    const result = await requestJson(isEdit ? `/api/materials/${editing.id}` : '/api/materials', {
      method: isEdit ? 'PATCH' : 'POST',
      body,
      fields: FIELD_LABELS,
    })
    setSaving(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    closeForm()
    // Re-runs the server component that fetched this list. No client-side
    // cache to keep in sync, and no duplicate fetching logic.
    router.refresh()
  }

  async function deactivate(material: MaterialDto) {
    setDeactivatingId(material.id)
    setListError('')
    const result = await requestJson(`/api/materials/${material.id}`, { method: 'DELETE' })
    setDeactivatingId(null)
    if (!result.ok) {
      setListError(`Could not deactivate ${material.name}: ${result.error}`)
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
            {list.total} active material{list.total === 1 ? '' : 's'}{list.q ? ' match' : ''}
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
        >
          <Plus size={16} /> New material
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
              <SortHeader label="Reorder point" sortKey="reorderPoint" firstDir="desc" align="right" {...{ sort: list.sort, path: '/admin/master', params: list.params }} />
              <th className="px-4 py-3 text-right font-medium">Current price</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {materials.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                  {list.q ? `No materials match \u201c${list.q}\u201d. The search looks at every page.` : 'No materials yet. Create one to get started.'}
                </td>
              </tr>
            )}
            {materials.map(material => (
              <tr key={material.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{material.code}</td>
                <td className="px-4 py-3 font-medium text-gray-800">{material.name}</td>
                <td className="px-4 py-3 text-gray-600">{material.categoryName}</td>
                <td className="px-4 py-3 text-gray-600">{material.unitAbbreviation}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                  {trimDecimal(material.reorderPoint)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {material.currentPrice
                    ? <span className="text-gray-800">{formatPeso(material.currentPrice)}</span>
                    : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <IconButton title="Price history" onClick={() => setPricingFor(material)}>
                      <History size={15} />
                    </IconButton>
                    <IconButton title="Edit" onClick={() => openEdit(material)}>
                      <Pencil size={15} />
                    </IconButton>
                    <IconButton title="Deactivate" onClick={() => deactivate(material)} disabled={deactivatingId === material.id}>
                      {deactivatingId === material.id ? <Loader2 size={15} className="animate-spin" /> : <Ban size={15} />}
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(creating || editing) && (
        <Modal title={editing ? `Edit ${editing.name}` : 'New material'} onClose={closeForm}>
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
                  placeholder="RM-PORK-BELLY"
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

            <Field label="Reorder point">
              <input
                className={inputClass}
                value={form.reorderPoint}
                onChange={e => setForm({ ...form, reorderPoint: e.target.value })}
                inputMode="decimal"
              />
            </Field>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={closeForm} className={secondaryButtonClass}>Cancel</button>
              <button onClick={save} disabled={saving} className={primaryButtonClass}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {pricingFor && (
        <PriceHistoryModal
          material={pricingFor}
          suppliers={suppliers}
          onClose={() => setPricingFor(null)}
          onRecorded={() => router.refresh()}
        />
      )}
    </div>
  )
}

/**
 * Price history + "record a new price". Recording is always an insert, so this
 * panel is append-only by design — there is no edit or delete on a price row.
 */
function PriceHistoryModal({
  material, suppliers, onClose, onRecorded,
}: {
  material: MaterialDto
  suppliers: { id: string; name: string }[]
  onClose: () => void
  onRecorded: () => void
}) {
  const [prices, setPrices]   = useState<PriceRow[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [unitPrice, setPrice] = useState('')
  const [date, setDate]       = useState(new Date().toISOString().slice(0, 10))
  const [supplierId, setSupplierId] = useState('')
  const [note, setNote]       = useState('')
  const [error, setError]     = useState('')
  const [saving, setSaving]   = useState(false)

  const load = useCallback(async () => {
    setLoadError('')
    const result = await requestJson<{ prices: PriceRow[] }>(`/api/materials/${material.id}/prices`)
    if (result.ok) setPrices(result.data.prices)
    else setLoadError(result.error)
  }, [material.id])

  // Must be an effect, not a render-body call — fetching in the body would
  // setState during render and loop forever.
  useEffect(() => { void load() }, [load])

  async function record() {
    setSaving(true)
    setError('')

    const result = await requestJson(`/api/materials/${material.id}/prices`, {
      body: {
        unitPrice,
        effectiveDate: date,
        supplierId:    supplierId || null,
        note:          note || null,
      },
      fields: { unitPrice: 'Unit price', effectiveDate: 'Effective date', supplierId: 'Supplier', note: 'Note' },
    })
    setSaving(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    setPrice('')
    setNote('')
    await load()
    onRecorded()
  }

  return (
    <Modal title={`Price history — ${material.name}`} onClose={onClose} wide>
      <div className="mb-5 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">
          Record a price
        </p>

        {error && (
          <div className="mb-3 rounded-lg border border-red-100 bg-red-50 p-2.5 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Unit price">
            <input
              className={inputClass}
              value={unitPrice}
              onChange={e => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder="380.00"
            />
          </Field>
          <Field label="Effective date">
            <input
              type="date"
              className={inputClass}
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </Field>
          <Field label="Supplier">
            <select
              className={inputClass}
              value={supplierId}
              onChange={e => setSupplierId(e.target.value)}
            >
              <option value="">Reference price</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Note">
            <input className={inputClass} value={note} onChange={e => setNote(e.target.value)} />
          </Field>
        </div>

        <div className="mt-3 flex justify-end">
          <button onClick={record} disabled={saving} className={primaryButtonClass}>
            {saving ? 'Recording...' : 'Record price'}
          </button>
        </div>

        <p className="mt-2 text-xs text-gray-400">
          Back-dating is allowed — the price in force on any date is the newest row on or before it.
        </p>
      </div>

      <table className="w-full text-sm">
        <thead className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="py-2 font-medium">Effective</th>
            <th className="py-2 text-right font-medium">Price</th>
            <th className="py-2 font-medium">Scope</th>
            <th className="py-2 font-medium">Note</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {prices === null && !loadError && (
            <tr><td colSpan={4} className="py-6 text-center text-gray-400">Loading prices…</td></tr>
          )}
          {loadError && (
            <tr>
              <td colSpan={4} className="py-6 text-center text-red-600" role="alert">
                Could not load the prices: {loadError}{' '}
                <button type="button" onClick={() => void load()} className="font-medium underline">Try again</button>
              </td>
            </tr>
          )}
          {prices?.length === 0 && (
            <tr><td colSpan={4} className="py-6 text-center text-gray-400">No prices recorded yet.</td></tr>
          )}
          {prices?.map(price => (
            <tr key={price.id}>
              <td className="py-2 text-gray-600">{price.effectiveDate.slice(0, 10)}</td>
              <td className="py-2 text-right tabular-nums text-gray-800">
                {formatPeso(price.unitPrice)}
              </td>
              <td className="py-2">
                {price.supplierName
                  ? <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">{price.supplierName}</span>
                  : <span className="text-xs text-gray-400">Reference</span>}
              </td>
              <td className="py-2 text-gray-500">{price.note ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}

