import Link from 'next/link'

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 w-full max-w-sm text-center">
        <h1 className="text-xl font-bold text-gray-800 mb-1">Access denied</h1>
        <p className="text-sm text-gray-400 mb-6">
          Your role doesn&apos;t have permission to view that page.
        </p>
        <Link
          href="/dashboard"
          className="inline-block w-full bg-orange-500 text-white py-2.5 rounded-lg font-medium hover:bg-orange-600 transition-colors text-sm"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}
