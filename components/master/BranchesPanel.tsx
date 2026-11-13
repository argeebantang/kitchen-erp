'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Ban, RotateCcw, X } from 'lucide-react'
import type { BranchType } from '@prisma/client'
import { Modal } from '@/components/ui/Modal'
import {
  Field, inputClass, primaryButtonClass, secondaryButtonClass,
} from '@/components/ui/form'
import type { BranchDto } from '@/services/branch.service'

// Here rather than in the service: a value import from a service would pull
// Prisma into the client bundle.
const BRANCH_TYPE_LABELS: Record<BranchType, string> = {
  COMMISSARY: 'Commissary',
  OUTLET:     'Outlet',
}

const FIELD_LABELS: Record<string, string> = {
  code: 'Code', name: 'Name', type: 'Type', address: 'Address', phone: 'Phone',
}

type Props = {
  branches: BranchDto[]
  /** Every BRANCH_MANAGER user — the people who can run a branch. */
  managers: { id: string; name: string; email: string }[]
}

// managerId '' = no manager.
const emptyForm = { code: '', name: '', type: 'OUTLET' as BranchType, address: '', phone: '', managerId: '' }

/** "Validation failed" alone tells the admin nothing — name the field and the rule. */
function errorMessage(data: { error?: string; fields?: Record<string, string[] | undefined> }): string {
  const fieldErrors = Object.entries(data.fields ?? {})
    .filter(([, messages]) => messages && messages.length > 0)
    .map(([field, messages]) => `${FIELD_LABELS[field] ?? field}: ${messages?.join(', ')}`)
  return fieldErrors.length > 0 ? fieldErrors.join(' · ') : (data.error ?? 'Save failed')
}

export function BranchesPanel({ branches, managers }: Props) {
  const router = useRouter()

  const [creating, setCreating] = useState(false)
  const [editing, setEditing]   = useState<BranchDto | null>(null)
  const [form, setForm]         = useState(emptyForm)
  const [error, setError]       = useState('')
  const [saving, setSaving]     = useState(false)
  // Deactivate / reactivate errors show above the table, not in the popup.
  const [rowError, setRowError] = useState('')
  const [busyId, setBusyId]     = useState<string | null>(null)

  const activeCount = branches.filter(b => b.isActive).length

  // Which branch each manager runs now, for "(manages Cubao)" and the move warning.
  const branchOfManager = new Map(
    branches.flatMap(b => (b.manager ? [[b.manager.id, b] as const] : [])),
  )
  const movingFrom = form.managerId ? branchOfManager.get(form.managerId) : undefined
  const movesManager = movingFrom !== undefined && movingFrom.id !== editing?.id

  function openCreate() {
    setForm(emptyForm)
    setError('')
    setCreating(true)
  }

  function openEdit(branch: BranchDto) {
    setForm({
      code:    branch.code,
      name:    branch.name,
      type:    branch.type,
      address: branch.address ?? '',
      phone:   branch.phone ?? '',
      managerId: branch.manager?.id ?? '',
    })
    setError('')
    setEditing(branch)
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
      name:    form.name,
      type:    form.type,
      address: form.address || null,
      phone:   form.phone || null,
      managerId: form.managerId || null,
      ...(isEdit ? {} : { code: form.code }),
    }

    const res = await fetch(isEdit ? `/api/branches/${editing.id}` : '/api/branches', {
      method:  isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })

    const data = await res.json()
    setSaving(false)

    if (!res.ok) {
      setError(errorMessage(data))
      return
    }

    close()
    router.refresh()
  }

  async function setActive(branch: BranchDto, active: boolean) {
    if (!active && !window.confirm(
      `Deactivate ${branch.name}? It will no longer appear in forms or inventory pages. You can reactivate it later.`,
    )) return

    setBusyId(branch.id)
    setRowError('')
    const res = await fetch(`/api/branches/${branch.id}/${active ? 'reactivate' : 'deactivate'}`, { method: 'POST' })
    const data = await res.json()
    setBusyId(null)

    if (!res.ok) {
      setRowError(data.error ?? (active ? 'Reactivate failed' : 'Deactivate failed'))
      return
    }
    router.refresh()
  }

  return (
    <div>
      {rowError && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">
          <span>{rowError}</span>
          <button title="Dismiss" onClick={() => setRowError('')} className="text-red-400 hover:text-red-600">
            <X size={15} />
          </button>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-400">
          {activeCount} active branch{activeCount === 1 ? '' : 'es'}
          {branches.length > activeCount && ` · ${branches.length - activeCount} inactive`}
        </p>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
        >
          <Plus size={16} /> New branch
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Address</th>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Manager</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {branches.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-gray-400">No branches yet.</td>
              </tr>
            )}
            {branches.map(branch => (
              <tr key={branch.id} className={`hover:bg-gray-50 ${branch.isActive ? '' : 'text-gray-400'}`}>
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{branch.code}</td>
                <td className={`px-4 py-3 font-medium ${branch.isActive ? 'text-gray-800' : 'text-gray-400'}`}>
                  {branch.name}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                      branch.type === 'COMMISSARY' ? 'bg-orange-50 text-orange-700' : 'bg-sky-50 text-sky-700'
                    }`}
                  >
                    {BRANCH_TYPE_LABELS[branch.type]}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">{branch.address ?? <span className="text-gray-300">—</span>}</td>
                <td className="px-4 py-3 text-gray-600">{branch.phone ?? <span className="text-gray-300">—</span>}</td>
                <td className="px-4 py-3 text-gray-600">
                  {branch.manager
                    ? <span title={branch.manager.email}>{branch.manager.name}</span>
                    : <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">None</span>}
                </td>
                <td className="px-4 py-3">
                  {branch.isActive
                    ? <span className="rounded bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-700">Active</span>
                    : <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500">Inactive</span>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <button
                      title="Edit"
                      onClick={() => openEdit(branch)}
                      className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                    >
                      <Pencil size={15} />
                    </button>
                    {branch.isActive ? (
                      <button
                        title="Deactivate"
                        disabled={busyId === branch.id}
                        onClick={() => setActive(branch, false)}
                        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600 disabled:opacity-50"
                      >
                        <Ban size={15} />
                      </button>
                    ) : (
                      <button
                        title="Reactivate"
                        disabled={busyId === branch.id}
                        onClick={() => setActive(branch, true)}
                        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-green-600 disabled:opacity-50"
                      >
                        <RotateCcw size={15} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(creating || editing) && (
        <Modal title={editing ? `Edit ${editing.name}` : 'New branch'} onClose={close}>
          {error && (
            <div className="mb-4 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Code">
                {editing ? (
                  // Fixed once created, so printed references stay valid (B1).
                  <p className="py-2 font-mono text-sm text-gray-600" title="A branch code cannot be changed">{editing.code}</p>
                ) : (
                  <input
                    className={`${inputClass} font-mono uppercase`}
                    value={form.code}
                    onChange={e => setForm({ ...form, code: e.target.value })}
                    placeholder="CUB"
                    maxLength={10}
                  />
                )}
              </Field>
              <div className="col-span-2">
                <Field label="Name">
                  <input
                    className={inputClass}
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="Cubao"
                  />
                </Field>
              </div>
            </div>
            {!editing && (
              <p className="-mt-1 text-xs text-gray-500">2–10 letters or digits. Cannot be changed later.</p>
            )}

            <Field label="Type">
              <select
                className={inputClass}
                value={form.type}
                onChange={e => setForm({ ...form, type: e.target.value === 'COMMISSARY' ? 'COMMISSARY' : 'OUTLET' })}
              >
                <option value="COMMISSARY">{BRANCH_TYPE_LABELS.COMMISSARY}</option>
                <option value="OUTLET">{BRANCH_TYPE_LABELS.OUTLET}</option>
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Every branch cooks. A commissary also sends finished goods to outlets.
              </p>
            </Field>

            <Field label="Address">
              <input
                className={inputClass}
                value={form.address}
                onChange={e => setForm({ ...form, address: e.target.value })}
              />
            </Field>

            <Field label="Phone">
              <input
                className={inputClass}
                value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })}
                inputMode="tel"
                placeholder="+63 917 123 4567"
              />
            </Field>

            <Field label="Manager">
              <select
                className={inputClass}
                value={form.managerId}
                onChange={e => setForm({ ...form, managerId: e.target.value })}
              >
                <option value="">— No manager —</option>
                {managers.map(m => {
                  const runs = branchOfManager.get(m.id)
                  const elsewhere = runs && runs.id !== editing?.id ? ` — manages ${runs.name}` : ''
                  return <option key={m.id} value={m.id}>{m.name} ({m.email}){elsewhere}</option>
                })}
              </select>
              {movesManager && movingFrom && (
                <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">
                  {movingFrom.manager?.name} runs {movingFrom.name} now. Saving moves them here and leaves {movingFrom.name} without a manager.
                </p>
              )}
              {managers.length === 0 && (
                <p className="mt-1 text-xs text-gray-500">No users have the Branch Manager role yet.</p>
              )}
              <p className="mt-1 text-xs text-gray-500">One manager per branch; a manager runs one branch.</p>
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
