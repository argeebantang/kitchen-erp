'use client'

import Link, { useLinkStatus } from 'next/link'
import { usePathname } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { navigation } from '@/lib/navigation'

/**
 * Instant feedback on a click (Week 12 Task 1): a spinner from the moment the
 * link is clicked until its page shows. The page's skeleton only appears once
 * the server answers — at once in production, where links preload it, but not
 * in development, where nothing preloads. `useLinkStatus` must sit inside the
 * <Link>; the `data-pending` marker lets the link restyle itself via :has().
 */
function PendingSpinner() {
  const { pending } = useLinkStatus()
  if (!pending) return null
  return (
    <span data-pending className="ml-auto" role="status">
      <Loader2 size={14} className="animate-spin" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </span>
  )
}

type Props = {
  name: string
  role: string
}

export function Sidebar({ name, role }: Props) {
  const pathname = usePathname()

  function canAccess(roles: string[]): boolean {
    return roles.length === 0 || roles.includes(role)
  }

  return (
    <aside className="flex flex-col w-64 min-h-screen bg-gray-900 text-gray-100">

      {/* Logo */}
      <div className="flex items-center gap-2 px-6 py-5 border-b border-gray-700">
        <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
          <span className="text-white font-bold text-sm">K</span>
        </div>
        <div>
          <p className="font-bold text-white text-sm leading-none">KitchenERP</p>
          <p className="text-gray-400 text-xs mt-0.5">Production & Inventory</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-6 overflow-y-auto">
        {navigation.map(group => {
          const visibleItems = group.items.filter(item => canAccess(item.roles))
          if (visibleItems.length === 0) return null

          return (
            <div key={group.group}>
              <p className="px-3 mb-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {group.group}
              </p>
              <ul className="space-y-0.5">
                {visibleItems.map(item => {
                  const Icon = item.icon
                  const isActive =
                    pathname === item.href ||
                    (item.href !== '/dashboard' && pathname.startsWith(item.href))

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${
                          isActive
                            ? 'bg-orange-500 text-white'
                            : 'text-gray-400 hover:bg-gray-800 hover:text-white has-[[data-pending]]:bg-gray-800 has-[[data-pending]]:text-white'
                        }`}
                      >
                        <Icon size={16} />
                        {item.label}
                        <PendingSpinner />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>

      {/* User info */}
      <div className="px-4 py-4 border-t border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">
              {name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">{name}</p>
            <p className="text-xs text-gray-400 truncate">{role.replace(/_/g, ' ')}</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
