'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Search, X } from 'lucide-react'
import { SEARCH_MAX } from '@/lib/list-query'

const DEBOUNCE_MS = 350

/**
 * Search a list as you type (Week 12). Writes ?q= into the URL — keeping the other filters and the sort,
 * going back to page 1 — and the server runs the search, so it covers every row, not just the page shown.
 * `replace`, not `push`: each keystroke is not a step for the Back button.
 */
export function SearchBox({ placeholder }: { placeholder: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const current = searchParams.get('q') ?? ''
  const [value, setValue] = useState(current)
  const [searching, startSearch] = useTransition()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Back / Forward, or a Clear filters link, changes ?q= underneath us.
  useEffect(() => { setValue(current) }, [current])
  useEffect(() => () => clearTimeout(timer.current), [])

  function go(next: string) {
    clearTimeout(timer.current)
    const params = new URLSearchParams(searchParams.toString())
    if (next.trim()) params.set('q', next.trim())
    else params.delete('q')
    params.delete('page')
    const text = params.toString()
    startSearch(() => router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false }))
  }

  function onChange(next: string) {
    setValue(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => go(next), DEBOUNCE_MS)
  }

  return (
    <div className="relative w-full max-w-xs">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
      <input
        type="search"
        value={value}
        maxLength={SEARCH_MAX}
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); go(value) }
          if (event.key === 'Escape' && value) { setValue(''); go('') }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-8 text-base sm:text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 [&::-webkit-search-cancel-button]:hidden"
      />
      <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
        {searching ? (
          <Loader2 size={14} className="animate-spin text-gray-400" aria-label="Searching" />
        ) : value ? (
          <button type="button" onClick={() => { setValue(''); go('') }} aria-label="Clear the search" className="text-gray-400 hover:text-gray-700">
            <X size={14} />
          </button>
        ) : null}
      </span>
    </div>
  )
}
