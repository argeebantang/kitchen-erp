'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Dev-only quick login. Matches prisma/seed.ts — every seeded account shares
// this password. Never rendered outside development (see isDev below).
const DEV_PASSWORD = 'password123'
const DEV_USERS = [
  { email: 'admin@kitchen.com',       label: 'Admin' },
  { email: 'procurement@kitchen.com', label: 'Procurement Manager' },
  { email: 'production@kitchen.com',  label: 'Production Manager' },
  { email: 'branch@kitchen.com',      label: 'Branch Manager' },
  { email: 'viewer@kitchen.com',      label: 'Viewer' },
]
const isDev = process.env.NODE_ENV === 'development'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleLogin(overrides?: { email: string; password: string }) {
    setLoading(true)
    setError('')

    const res = await fetch('/api/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(overrides ?? { email, password }),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Login failed')
      setLoading(false)
      return
    }

    router.push('/dashboard')
  }

  function handleQuickLogin(devEmail: string) {
    setEmail(devEmail)
    setPassword(DEV_PASSWORD)
    handleLogin({ email: devEmail, password: DEV_PASSWORD })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 w-full max-w-sm">

        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center">
            <span className="text-white font-bold">K</span>
          </div>
          <div>
            <p className="font-bold text-gray-800">KitchenERP</p>
            <p className="text-xs text-gray-400">Production & Inventory</p>
          </div>
        </div>

        <h1 className="text-xl font-bold text-gray-800 mb-1">Welcome back</h1>
        <p className="text-sm text-gray-400 mb-6">Sign in to your account</p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm border border-red-100">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder="you@kitchen.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder="••••••••"
            />
          </div>

          <button
            onClick={() => handleLogin()}
            disabled={loading}
            className="w-full bg-orange-500 text-white py-2.5 rounded-lg font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors text-sm"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </div>

        {isDev && (
          <div className="mt-6 pt-6 border-t border-gray-100">
            <p className="text-xs font-medium text-gray-400 mb-2">
              Dev quick login (seeded accounts)
            </p>
            <div className="flex flex-wrap gap-2">
              {DEV_USERS.map(u => (
                <button
                  key={u.email}
                  type="button"
                  onClick={() => handleQuickLogin(u.email)}
                  disabled={loading}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  {u.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
