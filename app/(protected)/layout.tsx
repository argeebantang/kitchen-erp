import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { UserRepository } from '@/repositories/user.repository'
import { AppShell } from '@/components/dashboard/AppShell'
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
    <AppShell name={user.name} email={user.email} role={user.role} initialCollapsed={sidebarCollapsed}>
      {children}
    </AppShell>
  )
}
