import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { secondaryButtonClass } from '@/components/ui/form'

/**
 * Shared page states (Week 12 Task 1). Server-safe — no hooks, no handlers —
 * so server pages, not-found.tsx and loading.tsx can all render them. The error
 * state needs a click handler and lives in ErrorState.tsx.
 */

/**
 * "Nothing here": an empty list, a record that is not available, an unknown
 * URL. The dashed card is the look the not-found pages already used.
 */
export function EmptyState({ icon: Icon, title, children, action }: {
  icon?:     LucideIcon
  title:     string
  /** One or two sentences: why it is empty, or what to do next. */
  children?: React.ReactNode
  action?:   { href: string; label: string }
}) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
      {Icon && (
        <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-400">
          <Icon size={18} aria-hidden="true" />
        </span>
      )}
      <p className="text-sm font-medium text-gray-600">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-gray-400">{children}</div>}
      {action && (
        <Link href={action.href} className={`mt-4 inline-block ${secondaryButtonClass}`}>
          {action.label}
        </Link>
      )}
    </div>
  )
}

const ROW_WIDTHS = ['w-2/3', 'w-1/2', 'w-3/4', 'w-2/5', 'w-3/5', 'w-1/2']

/**
 * What a page shows while its data loads: a placeholder of the usual page —
 * title, subtitle, a table. One shape for every screen, because Next.js picks
 * the loading.tsx of the folder ABOVE the page that changes, not of the page
 * being opened (docs/architecture.md, "Page states").
 *
 * `animate-appear` holds it invisible for 150 ms, so a page that answers
 * quickly never flashes a skeleton.
 */
export function PageSkeleton() {
  return (
    <div role="status" aria-live="polite" className="animate-appear">
      <span className="sr-only">Loading…</span>
      <div className="animate-pulse" aria-hidden="true">
        <div className="mb-6">
          <div className="h-7 w-56 rounded bg-gray-200" />
          <div className="mt-2 h-4 w-96 max-w-full rounded bg-gray-100" />
        </div>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
            <div className="h-3 w-2/3 rounded bg-gray-200" />
          </div>
          <div className="divide-y divide-gray-100">
            {ROW_WIDTHS.map((width, index) => (
              <div key={index} className="flex gap-6 px-4 py-4">
                <div className="h-3 w-24 shrink-0 rounded bg-gray-100" />
                <div className={`h-3 ${width} rounded bg-gray-100`} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
