import Link from 'next/link'
import { ChevronDown, ChevronUp, ChevronsUpDown, SearchX } from 'lucide-react'
import { PendingSpinner } from '@/components/ui/PendingSpinner'
import { EmptyState } from '@/components/ui/states'
import { listHref, type ListSort, type SearchParams } from '@/lib/list-query'

/**
 * The paging bar and sortable column headers of every list (Week 12). Plain links that rewrite the URL
 * (lib/list-query.ts), so the server renders each page and filters, search and sort survive paging.
 * Server-safe: no hooks here; PendingSpinner is the only client part.
 */

const pageButton = 'inline-flex min-w-9 items-center justify-center rounded-lg border px-2.5 py-1.5 text-sm'

/** Page numbers to show: the first, the last, and two either side of the current one, with gaps. */
function pageWindow(page: number, pageCount: number): (number | 'gap')[] {
  const pages = new Set([1, pageCount, page - 2, page - 1, page, page + 1, page + 2].filter(n => n >= 1 && n <= pageCount))
  const sorted = [...pages].sort((a, b) => a - b)
  return sorted.flatMap((n, index) => (index > 0 && n - sorted[index - 1] > 1 ? ['gap' as const, n] : [n]))
}

export function Pagination({ path, params, page, pageSize, total, noun = 'rows' }: {
  path:     string
  params:   SearchParams
  page:     number
  pageSize: number
  total:    number
  /** "Showing 1–50 of 232 requests". */
  noun?:    string
}) {
  if (total === 0) return null
  // Every noun here is a plain plural ("requests", "finished goods", "BOMs"): one of them drops the s.
  const counted = `${total} ${total === 1 ? noun.replace(/s$/, '') : noun}`
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const from = Math.min(total, (page - 1) * pageSize + 1)
  const to = Math.min(total, page * pageSize)
  const href = (target: number) => listHref(path, params, { page: target })

  return (
    <nav aria-label="Pages" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-500">
      <span>
        {page > pageCount ? `Page ${page} is past the end — there ${total === 1 ? 'is' : 'are'} ${counted}` : `Showing ${from}–${to} of ${counted}`}
      </span>
      {pageCount > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          {page > 1 && (
            <Link href={href(Math.min(page - 1, pageCount))} className={`${pageButton} border-gray-200 bg-white text-gray-600 hover:bg-gray-50`}>
              ‹ Prev<PendingSpinner />
            </Link>
          )}
          {pageWindow(Math.min(page, pageCount), pageCount).map((item, index) => item === 'gap' ? (
            <span key={`gap-${index}`} className="px-1 text-gray-400">…</span>
          ) : item === page ? (
            <span key={item} aria-current="page" className={`${pageButton} border-orange-300 bg-orange-50 font-medium text-orange-700`}>{item}</span>
          ) : (
            <Link key={item} href={href(item)} className={`${pageButton} border-gray-200 bg-white text-gray-600 hover:bg-gray-50`}>
              {item}<PendingSpinner />
            </Link>
          ))}
          {page < pageCount && (
            <Link href={href(page + 1)} className={`${pageButton} border-gray-200 bg-white text-gray-600 hover:bg-gray-50`}>
              Next ›<PendingSpinner />
            </Link>
          )}
        </div>
      )}
    </nav>
  )
}

/**
 * A table header that sorts by its column. Clicking the sorted column flips the direction; another column
 * starts at `firstDir` (newest-first for dates and numbers reads best). Sorting returns to page 1.
 */
export function SortHeader<K extends string>({ label, sortKey, sort, path, params, firstDir = 'asc', align = 'left' }: {
  label:     string
  sortKey:   K
  sort:      ListSort<K>
  path:      string
  params:    SearchParams
  firstDir?: 'asc' | 'desc'
  align?:    'left' | 'right'
}) {
  const active = sort.key === sortKey
  const nextDir = active ? (sort.dir === 'asc' ? 'desc' : 'asc') : firstDir
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ChevronUp : ChevronDown
  return (
    <th
      className={`px-4 py-3 font-medium ${align === 'right' ? 'text-right' : ''}`}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <Link
        href={listHref(path, params, { sort: sortKey, dir: nextDir, page: null })}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-gray-800 ${active ? 'text-gray-800' : ''} ${align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        {label}
        <Icon size={12} className={active ? 'text-orange-600' : 'text-gray-300'} aria-hidden="true" />
        <PendingSpinner className="inline-flex" />
      </Link>
    </th>
  )
}

/**
 * The empty states paging and search add to every list: a search with no match, and a page past the end
 * (an old link after rows were removed, or a hand-typed ?page=). Null when neither applies, so the page's own
 * "No X yet" / "No X match these filters" shows.
 */
export function ListEmptyState({ path, params, q, rowCount, total, noun }: {
  path:     string
  params:   SearchParams
  q:        string
  rowCount: number
  total:    number
  noun:     string
}) {
  if (rowCount === 0 && total > 0) {
    return <EmptyState icon={SearchX} title="Nothing on this page" action={{ href: listHref(path, params, { page: null }), label: 'Go to the first page' }} />
  }
  if (total === 0 && q) {
    return (
      <EmptyState icon={SearchX} title={`No ${noun} match \u201c${q}\u201d`} action={{ href: listHref(path, params, { q: null, page: null }), label: 'Clear the search' }}>
        The search looks at every page, not just this one.
      </EmptyState>
    )
  }
  return null
}

/**
 * Inside a list's GET filter form: carries the search and sort through "Apply", which submits only the
 * form's own fields. Paging is dropped on purpose — new filters start at page 1.
 */
export function KeepListParams({ params }: { params: SearchParams }) {
  return (
    <>
      {(['q', 'sort', 'dir'] as const).map(name => {
        const value = params[name]
        const single = Array.isArray(value) ? value[0] : value
        return single ? <input key={name} type="hidden" name={name} value={single} /> : null
      })}
    </>
  )
}
