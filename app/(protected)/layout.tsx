import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { UserRepository } from '@/repositories/user.repository'
import { Sidebar } from '@/components/dashboard/Sidebar'

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

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar name={user.name} role={user.role} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Topbar comes next step */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
