import { getSession } from '@/lib/session'

export default async function DashboardPage() {
  const session = await getSession()

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800">
        Welcome, {session?.email}
      </h2>
      <p className="text-gray-400 text-sm mt-1">
        Role: {session?.role}
      </p>
    </div>
  )
}
