'use client'

import { useEffect, useState } from 'react'

export type AuthUser = {
  id: string
  email: string
  name: string
  role: string
  branchId: string | null
}

export function useUser() {
  const [user, setUser]       = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => {
        if (!res.ok) throw new Error('Unauthorized')
        return res.json()
      })
      .then(data => setUser(data.user))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  return { user, loading, error }
}
