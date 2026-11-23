'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/form'
// Type-only, so nothing from the service is bundled into the browser.
import type { HolidayDto } from '@/services/holiday.service'

type HolidayType = HolidayDto['type']

/** The labels, repeated here as a value (the service's map is server code). */
const TYPE_LABELS: Record<HolidayType, string> = {
  REGULAR:             'Regular holiday',
  SPECIAL_NON_WORKING: 'Special non-working day',
  SPECIAL_WORKING:     'Special working day',
  LOCAL:               'Local (fiesta, event)',
}
const TYPES = Object.keys(TYPE_LABELS) as HolidayType[]

/** "Mon, Nov 30" — the weekday matters for a kitchen. */
function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

type Draft = { date: string; name: string; type: HolidayType }

async function send(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: Draft): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body:    body ? JSON.stringify(body) : undefined,
    })
    if (response.ok) return null
    const result = await response.json().catch(() => null)
    return result?.error === 'Validation failed' ? 'Give a date, a name and a type.' : (result?.error ?? `Could not save (${response.status})`)
  } catch {
    return 'Could not reach the server'
  }
}

/**
 * Master Data → Holidays (Week 10 Task 5): the days the Demand Forecaster
 * treats apart — national holidays (pre-filled for 2026), Eid'l Fitr / Eid'l
 * Adha once proclaimed, and the business's own days.
 */
export function HolidaysPanel({ year, years, holidays }: { year: number; years: number[]; holidays: HolidayDto[] }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {years.map(option => (
          <Link
            key={option}
            href={`/admin/master?tab=holidays&year=${option}`}
            className={`rounded-lg border px-3 py-1.5 text-sm ${option === year ? 'border-orange-300 bg-orange-50 font-medium text-orange-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            {option}
          </Link>
        ))}
      </div>

      <AddHoliday year={year} />

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {holidays.map(holiday => <HolidayRow key={holiday.id} holiday={holiday} />)}
          </tbody>
        </table>
        {holidays.length === 0 && <p className="px-4 py-6 text-center text-sm text-gray-500">No holidays for {year} yet.</p>}
        <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400">
          The Demand Forecaster leaves these days out of its weekday averages and shows how past ones went. Add Eid&apos;l
          Fitr and Eid&apos;l Adha when they are proclaimed, next year&apos;s list, and your own days (town fiestas, events
          near an outlet) as Local.
        </p>
      </div>
    </div>
  )
}

function AddHoliday({ year }: { year: number }) {
  const router = useRouter()
  const empty: Draft = { date: '', name: '', type: 'SPECIAL_NON_WORKING' }
  const [draft, setDraft] = useState<Draft>(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    const failed = await send('/api/holidays', 'POST', draft)
    setSaving(false)
    if (failed) { setError(failed); return }
    setDraft(empty)
    // Show the year the new day is in.
    const addedYear = Number(draft.date.slice(0, 4))
    if (addedYear !== year) router.push(`/admin/master?tab=holidays&year=${addedYear}`)
    router.refresh()
  }

  return (
    <form onSubmit={add} className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-white p-4">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500">Date</span>
        <input type="date" value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} className={inputClass} required />
      </label>
      <label className="block min-w-56 flex-1">
        <span className="mb-1 block text-xs font-medium text-gray-500">Name</span>
        <input type="text" value={draft.name} maxLength={100} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. Eid'l Fitr, Las Piñas fiesta" className={inputClass} required />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500">Type</span>
        <select value={draft.type} onChange={event => setDraft({ ...draft, type: event.target.value as HolidayType })} className={inputClass}>
          {TYPES.map(type => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
        </select>
      </label>
      <button type="submit" disabled={saving} className={primaryButtonClass}>{saving ? 'Adding…' : 'Add holiday'}</button>
      {error && <p className="w-full text-sm text-red-700">{error}</p>}
    </form>
  )
}

function HolidayRow({ holiday }: { holiday: HolidayDto }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Draft>({ date: holiday.date, name: holiday.name, type: holiday.type })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(method: 'PATCH' | 'DELETE') {
    if (method === 'DELETE' && !window.confirm(`Remove ${holiday.name} (${holiday.date})?`)) return
    setBusy(true)
    setError(null)
    const failed = await send(`/api/holidays/${holiday.id}`, method, method === 'PATCH' ? draft : undefined)
    setBusy(false)
    if (failed) { setError(failed); return }
    setEditing(false)
    router.refresh()
  }

  if (!editing) {
    return (
      <tr>
        <td className="whitespace-nowrap px-4 py-2.5 text-gray-700">{dayLabel(holiday.date)} <span className="text-xs text-gray-400">{holiday.date}</span></td>
        <td className="px-4 py-2.5 text-gray-800">{holiday.name}</td>
        <td className="px-4 py-2.5 text-gray-500">{TYPE_LABELS[holiday.type]}</td>
        <td className="px-4 py-2.5 text-right">
          <button type="button" onClick={() => setEditing(true)} className="text-sm font-medium text-orange-600 hover:underline">Edit</button>
          <button type="button" onClick={() => run('DELETE')} disabled={busy} className="ml-3 text-sm font-medium text-red-600 hover:underline">Remove</button>
          {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
        </td>
      </tr>
    )
  }

  return (
    <tr className="bg-orange-50/40">
      <td className="px-4 py-2"><input type="date" value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} className={inputClass} /></td>
      <td className="px-4 py-2"><input type="text" value={draft.name} maxLength={100} onChange={event => setDraft({ ...draft, name: event.target.value })} className={inputClass} /></td>
      <td className="px-4 py-2">
        <select value={draft.type} onChange={event => setDraft({ ...draft, type: event.target.value as HolidayType })} className={inputClass}>
          {TYPES.map(type => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
        </select>
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-right">
        <button type="button" onClick={() => run('PATCH')} disabled={busy} className={`${secondaryButtonClass} px-3 py-1.5`}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={() => { setEditing(false); setDraft({ date: holiday.date, name: holiday.name, type: holiday.type }) }} className="ml-2 text-sm text-gray-500 hover:underline">Cancel</button>
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      </td>
    </tr>
  )
}
