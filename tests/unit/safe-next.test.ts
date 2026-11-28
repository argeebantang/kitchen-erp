import { describe, expect, it } from 'vitest'
import { safeNextPath } from '@/lib/safe-next'

/** `?next=` after sign-in must never send anyone off this app (open redirect). */
describe('safeNextPath', () => {
  it('keeps a path on this app, with its query and hash', () => {
    expect(safeNextPath('/inventory/receive')).toBe('/inventory/receive')
    expect(safeNextPath('/inventory/transfers/abc?scan=1#count')).toBe('/inventory/transfers/abc?scan=1#count')
  })

  it('normalises dot segments', () => {
    expect(safeNextPath('/a/../dashboard')).toBe('/dashboard')
  })

  it('gives null for nothing', () => {
    expect(safeNextPath(null)).toBeNull()
    expect(safeNextPath(undefined)).toBeNull()
    expect(safeNextPath('')).toBeNull()
  })

  it.each([
    'https://evil.example/login',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    'evil.example',
    ' /dashboard',
  ])('refuses %j', value => {
    expect(safeNextPath(value)).toBeNull()
  })

  it('refuses the login page itself, which would loop', () => {
    expect(safeNextPath('/login')).toBeNull()
    expect(safeNextPath('/login?next=/dashboard')).toBeNull()
    expect(safeNextPath('/login/')).toBeNull()
  })
})
