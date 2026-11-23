import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { UserRepository } from '@/repositories/user.repository'
import { Sidebar } from '@/components/dashboard/Sidebar'
import { Topbar } from '@/components/dashboard/Topbar'
import { SIDEBAR_COOKIE } from '@/lib/navigation'

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()

  if (!session) {
    redirect('/login')
  }

  // Fetch fresh user data — also catches deleted users with valid tokens
  const user = await UserRepository.findById(session.userId)

  if (!user) {
    redirect('/login')
  }

  // Read here, not in the browser, so a collapsed sidebar is collapsed in the
  // first paint instead of flashing open.
  const sidebarCollapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === 'collapsed'

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar name={user.name} role={user.role} initialCollapsed={sidebarCollapsed} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar name={user.name} email={user.email} role={user.role} />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
