'use client'

import { useState } from 'react'
import { Sidebar } from '@/components/dashboard/Sidebar'
import { Topbar } from '@/components/dashboard/Topbar'

type Props = {
  name: string
  email: string
  role: string
  initialCollapsed: boolean
  children: React.ReactNode
}

/**
 * The signed-in frame: sidebar, top bar and the page. Holds one piece of state
 * the two bars share — whether the sidebar is open as a drawer on a phone
 * (below `md`), where a 256px sidebar would leave the page ~120px. From `md`
 * up the sidebar is in the layout as before and `mobileOpen` stays false.
 * A Client Component only for that state: `children` are still the Server
 * Component pages, passed through untouched.
 */
export function AppShell({ name, email, role, initialCollapsed, children }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar
        name={name}
        role={role}
        initialCollapsed={initialCollapsed}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar name={name} email={email} role={role} onOpenMenu={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
