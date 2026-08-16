'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, ChevronDown } from 'lucide-react'

type Props = {
  name: string
  email: string
  role: string
}

export function Topbar({ name, email, role }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function handleLogout() {
    setLoading(true)
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  const initial = name.charAt(0).toUpperCase()
  const roleLabel = role.replace(/_/g, ' ').toLowerCase()

  return (
    <header className="flex items-center justify-between h-16 px-6 bg-white border-b border-gray-200">
      {/* Greeting */}
      <div className="leading-tight">
        <p className="text-xs text-gray-400">Welcome back,</p>
        <p className="text-sm font-semibold text-gray-800">{name}</p>
      </div>

      {/* User menu */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2.5 py-1.5 pl-1.5 pr-2 rounded-lg transition-colors hover:bg-gray-100"
        >
          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-orange-500 flex-shrink-0">
            <span className="text-sm font-bold text-white">{initial}</span>
          </div>
          <div className="hidden text-left sm:block">
            <p className="text-sm font-medium leading-tight text-gray-800">{name}</p>
            <p className="text-xs leading-tight text-gray-400 capitalize">{roleLabel}</p>
          </div>
          <ChevronDown
            size={16}
            className={`text-gray-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {open && (
          <div className="absolute right-0 mt-2 w-60 py-1 origin-top-right rounded-xl border border-gray-200 bg-white shadow-lg">
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-800 truncate">{name}</p>
              <p className="text-xs text-gray-400 truncate">{email}</p>
              <span className="inline-block mt-2 px-2 py-0.5 rounded-full bg-orange-50 text-xs font-medium text-orange-600 capitalize">
                {roleLabel}
              </span>
            </div>
            <button
              onClick={handleLogout}
              disabled={loading}
              className="flex items-center w-full gap-2 px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
            >
              <LogOut size={15} />
              {loading ? 'Signing out...' : 'Log out'}
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
