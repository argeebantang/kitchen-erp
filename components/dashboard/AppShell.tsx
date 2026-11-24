'use client'

import { useState } from 'react'
import { Sidebar } from '@/components/dashboard/Sidebar'
import { Topbar } from '@/components/dashboard/Topbar'
import { OfflineBanner } from '@/components/pwa/OfflineBanner'

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

  // h-dvh, not h-screen: on a phone 100vh is the height with the browser's
  // toolbars hidden, so the bottom of the page sat behind Safari's toolbar.
  // The safe-area insets are non-zero only with viewport-fit=cover (app/layout)
  // on a phone with a notch or a home bar — 0 everywhere else.
  return (
    <div className="flex h-dvh overflow-hidden bg-gray-50 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <Sidebar
        name={name}
        role={role}
        initialCollapsed={initialCollapsed}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar name={name} email={email} role={role} onOpenMenu={() => setMobileOpen(true)} />
        <OfflineBanner />
        {/* overscroll-contain: scrolling past the end does not drag the whole app (a web tell on phones). */}
        <main className="flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
