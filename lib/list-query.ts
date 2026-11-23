/**
 * Paging, search and sort for list pages, all in the URL (Week 12): `?page=3&q=pork&sort=number&dir=asc`.
 * The page reads them with parseListQuery, the repository turns them into skip / take / where / orderBy, and
 * the paging bar, search box and column headers write them back with listHref. Server-safe and client-safe:
 * no Prisma, no Node APIs.
 */

export const PAGE_SIZE = 50
/** Longer is not a search, and it would go into a LIKE pattern on every row. */
export const SEARCH_MAX = 100

export type SortDir = 'asc' | 'desc'
export type ListSort<K extends string = string> = { key: K; dir: SortDir }

export type SearchParams = Record<string, string | string[] | undefined>

export type ListQuery<K extends string> = {
  page:   number
  /** Trimmed; '' = no search. */
  q:      string
  sort:   ListSort<K>
  skip:   number
  take:   number
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Reads ?page, ?q, ?sort and ?dir. Anything unknown falls back to the default rather than failing — a stale or
 * hand-edited link still opens the list.
 */
export function parseListQuery<K extends string>(
  params: SearchParams,
  options: { sorts: readonly K[]; defaultSort: ListSort<K>; pageSize?: number },
): ListQuery<K> {
  const pageSize = options.pageSize ?? PAGE_SIZE
  const page = Math.max(1, Number.parseInt(first(params.page) ?? '1', 10) || 1)
  const q = (first(params.q) ?? '').trim().slice(0, SEARCH_MAX)
  const sortParam = first(params.sort)
  const dirParam = first(params.dir)
  const key = options.sorts.includes(sortParam as K) ? (sortParam as K) : options.defaultSort.key
  const dir: SortDir = dirParam === 'asc' || dirParam === 'desc'
    ? dirParam
    : key === options.defaultSort.key ? options.defaultSort.dir : 'asc'
  return { page, q, sort: { key, dir }, skip: (page - 1) * pageSize, take: pageSize }
}

/** The current URL with some parameters changed; null removes one. Empty values are dropped. */
export function listHref(path: string, params: SearchParams, changes: Record<string, string | number | null>): string {
  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) {
    const single = first(value)
    if (single !== undefined && single !== '' && !(name in changes)) query.set(name, single)
  }
  for (const [name, value] of Object.entries(changes)) {
    if (value !== null && value !== '') query.set(name, String(value))
  }
  // Page 1 is the default; leaving it out keeps links short and stable.
  if (query.get('page') === '1') query.delete('page')
  const text = query.toString()
  return text ? `${path}?${text}` : path
}

/** A Prisma `contains` that ignores case — every list search uses it. */
export function containsText(q: string) {
  return { contains: q, mode: 'insensitive' as const }
}
