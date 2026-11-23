'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { PanelLeftClose, PanelLeftOpen, Search, X } from 'lucide-react'
import { matchScore, navigation, SIDEBAR_COOKIE, type NavItem } from '@/lib/navigation'
import { PendingSpinner } from '@/components/ui/PendingSpinner'

type Props = {
  name: string
  role: string
  /** From the cookie, read by the protected layout — so the first paint is already the right width. */
  initialCollapsed: boolean
}

const ONE_YEAR = 60 * 60 * 24 * 365

/** Typing in a field must not trigger the "/" shortcut. */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

export function Sidebar({ name, role, initialCollapsed }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  // Set when the collapsed rail's search button (or "/") opens the sidebar:
  // the input only exists once it has expanded.
  const focusAfterExpand = useRef(false)

  const { groups, firstMatch } = useMemo(() => {
    const needle = query.trim().toLowerCase()
    let best: { item: NavItem; score: number } | null = null
    const visible = navigation
      .map(group => ({
        group: group.group,
        items: group.items.filter(item => {
          if (item.roles.length > 0 && !item.roles.includes(role)) return false
          if (needle === '') return true
          const score = matchScore(item, group.group, needle)
          if (score !== null && (best === null || score < best.score)) best = { item, score }
          return score !== null
        }),
      }))
      .filter(group => group.items.length > 0)
    return { groups: visible, firstMatch: (best as { item: NavItem } | null)?.item }
  }, [role, query])

  function setCollapsedAndRemember(next: boolean) {
    setCollapsed(next)
    document.cookie = `${SIDEBAR_COOKIE}=${next ? 'collapsed' : 'expanded'}; path=/; max-age=${ONE_YEAR}; samesite=lax`
  }

  function openSearch() {
    if (collapsed) {
      focusAfterExpand.current = true
      setCollapsedAndRemember(false)
    } else {
      searchRef.current?.focus()
    }
  }

  useEffect(() => {
    if (!collapsed && focusAfterExpand.current) {
      focusAfterExpand.current = false
      searchRef.current?.focus()
    }
  }, [collapsed])

  // "/" anywhere on the page jumps to the search, as on GitHub.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return
      event.preventDefault()
      openSearch()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && firstMatch) {
      event.preventDefault()
      router.push(firstMatch.href)
      setQuery('')
      searchRef.current?.blur()
    } else if (event.key === 'Escape') {
      if (query) setQuery('')
      else searchRef.current?.blur()
    }
  }

  return (
    <aside
      className={`flex min-h-screen shrink-0 flex-col bg-gray-900 text-gray-100 transition-[width] duration-200 ${collapsed ? 'w-16' : 'w-64'}`}
    >

      {/* Logo */}
      <div className={`flex items-center gap-2 border-b border-gray-700 py-5 ${collapsed ? 'justify-center px-2' : 'px-6'}`}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-500">
          <span className="text-sm font-bold text-white">K</span>
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-sm font-bold leading-none text-white">KitchenERP</p>
            <p className="mt-0.5 truncate text-xs text-gray-400">Production & Inventory</p>
          </div>
        )}
      </div>

      {/* Navigation. The search sits inside the scrolling area, pinned to its top, so it has
          the menu's exact width — a scrollbar narrows both alike. */}
      <nav
        className={`flex-1 overflow-y-auto pb-4 [scrollbar-color:var(--color-gray-700)_transparent] [scrollbar-width:thin] ${collapsed ? 'px-2' : 'px-3'}`}
      >
        {/* Search */}
        <div className="sticky top-0 z-10 bg-gray-900 pb-4 pt-4">
          {collapsed ? (
            <button
              type="button"
              onClick={openSearch}
              title="Search the menu ( / )"
              aria-label="Search the menu"
              className="flex w-full items-center justify-center rounded-lg py-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
            >
              <Search size={16} />
            </button>
          ) : (
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={event => setQuery(event.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="Search the menu"
                aria-label="Search the menu"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 py-2 pl-10 pr-8 text-sm text-gray-100 placeholder:text-gray-500 focus:border-orange-500 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => { setQuery(''); searchRef.current?.focus() }}
                  aria-label="Clear the search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-500 hover:text-white"
                >
                  <X size={14} />
                </button>
              ) : (
                <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-gray-700 px-1.5 text-[10px] text-gray-500">/</kbd>
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          {groups.length === 0 && (
            <p className="px-3 text-sm text-gray-500">No page matches &ldquo;{query.trim()}&rdquo;.</p>
          )}
          {groups.map((group, groupIndex) => (
            <div key={group.group}>
              {collapsed ? (
                groupIndex > 0 && <div className="mx-2 mb-3 border-t border-gray-800" aria-hidden="true" />
              ) : (
                <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  {group.group}
                </p>
              )}
              <ul className="space-y-0.5">
                {group.items.map(item => {
                  const Icon = item.icon
                  const isActive =
                    pathname === item.href ||
                    (item.href !== '/dashboard' && pathname.startsWith(item.href))
                  // While searching, Enter opens this one.
                  const isFirstMatch = query.trim() !== '' && item === firstMatch

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        title={collapsed ? item.label : undefined}
                        aria-label={collapsed ? item.label : undefined}
                        onClick={() => setQuery('')}
                        className={`relative flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-colors duration-150 ${
                          collapsed ? 'justify-center px-2' : 'px-3'
                        } ${
                          isActive
                            ? 'bg-orange-500 text-white'
                            : `text-gray-400 hover:bg-gray-800 hover:text-white has-[[data-pending]]:bg-gray-800 has-[[data-pending]]:text-white ${isFirstMatch ? 'ring-1 ring-gray-600' : ''}`
                        }`}
                      >
                        <Icon size={16} className="shrink-0" />
                        {!collapsed && item.label}
                        <PendingSpinner className={collapsed ? 'absolute right-0.5 top-0.5' : 'ml-auto'} />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      {/* Collapse */}
      <div className={`border-t border-gray-800 py-2 ${collapsed ? 'px-2' : 'px-3'}`}>
        <button
          type="button"
          onClick={() => setCollapsedAndRemember(!collapsed)}
          title={collapsed ? 'Expand the sidebar' : undefined}
          aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
          aria-expanded={!collapsed}
          className={`flex w-full items-center gap-3 rounded-lg py-2 text-sm text-gray-400 transition-colors hover:bg-gray-800 hover:text-white ${collapsed ? 'justify-center px-2' : 'px-3'}`}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <><PanelLeftClose size={16} /> Collapse</>}
        </button>
      </div>

      {/* User info */}
      <div className={`border-t border-gray-700 py-4 ${collapsed ? 'flex justify-center px-2' : 'px-4'}`}>
        <div className="flex items-center gap-3" title={collapsed ? `${name} · ${role.replace(/_/g, ' ')}` : undefined}>
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-orange-500">
            <span className="text-xs font-bold text-white">
              {name.charAt(0).toUpperCase()}
            </span>
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{name}</p>
              <p className="truncate text-xs text-gray-400">{role.replace(/_/g, ' ')}</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
