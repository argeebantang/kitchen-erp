'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { primaryButtonClass } from '@/components/ui/form'

type Props = {
  reportKey: string
  presets: { value: string; label: string }[]
  branches: { id: string; name: string }[]
  branchLabel: string | null
  /** Held to one branch (a branch manager): the select shows it, with no "All". */
  branchFixed: boolean
  maxDays: number
  /** One day (the End-of-Day Snapshot): a single date instead of from–to. */
  singleDay: boolean
  /** What the page shows now. */
  current: { preset: string | null; from: string; to: string; branchId: string | null }
}

const CUSTOM = 'custom'

/**
 * A report's period and branch (Week 11 Task 4), kept in the URL so a report
 * can be bookmarked or shared. Apply navigates; the downloads below use the
 * same query, so the Excel and PDF are exactly what is on screen.
 */
export function ReportFilters({ reportKey, presets, branches, branchLabel, branchFixed, maxDays, singleDay, current }: Props) {
  const router = useRouter()
  const [preset, setPreset] = useState(current.preset ?? CUSTOM)
  const [from, setFrom] = useState(current.from)
  const [to, setTo] = useState(current.to)
  const [branchId, setBranchId] = useState(current.branchId ?? '')

  function apply(event: React.FormEvent) {
    event.preventDefault()
    const query = new URLSearchParams()
    if (preset === CUSTOM && singleDay) {
      query.set('date', from)
    } else if (preset === CUSTOM) {
      query.set('from', from)
      query.set('to', to)
    } else {
      query.set('preset', preset)
    }
    if (branchId) query.set('branch', branchId)
    router.push(`/reports/${reportKey}?${query.toString()}`)
  }

  const fieldClass = 'rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400'

  return (
    <form onSubmit={apply} className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4">
      <label className="text-sm">
        <span className="mb-1 block font-medium text-gray-700">Period</span>
        <select value={preset} onChange={event => setPreset(event.target.value)} className={fieldClass}>
          {presets.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          <option value={CUSTOM}>{singleDay ? 'Pick a date…' : 'Custom dates…'}</option>
        </select>
      </label>
      {preset === CUSTOM && (
        <>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-gray-700">{singleDay ? 'Date' : 'From'}</span>
            <input type="date" value={from} onChange={event => setFrom(event.target.value)} required className={fieldClass} />
          </label>
          {!singleDay && (
            <label className="text-sm">
              <span className="mb-1 block font-medium text-gray-700">To</span>
              <input type="date" value={to} onChange={event => setTo(event.target.value)} required className={fieldClass} />
            </label>
          )}
        </>
      )}
      {branchLabel && (
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">{branchLabel}</span>
          <select value={branchId} onChange={event => setBranchId(event.target.value)} className={fieldClass}>
            {!branchFixed && <option value="">All</option>}
            {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </label>
      )}
      <button type="submit" className={primaryButtonClass}>Show</button>
      {preset === CUSTOM && !singleDay && <p className="w-full text-xs text-gray-400">Up to {maxDays} days, ending today at the latest.</p>}
    </form>
  )
}
