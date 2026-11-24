/**
 * Where to go after signing in (Week 12): the page a signed-out visitor was
 * sent away from — a scanned label, a link in an email — as `?next=` on
 * /login. Only a path on this app is accepted; anything else (another site,
 * "//evil.example", "/\evil.example", a javascript: URL) gives null and the
 * caller falls back to the dashboard, so the parameter cannot be used to
 * bounce someone from the login page to a look-alike site.
 *
 * No Node or DOM APIs: the middleware (Edge) and the login page both use it.
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null
  // Resolve against a placeholder origin: if the result left it, the value was not a plain path.
  const base = 'http://app.invalid'
  let url: URL
  try {
    url = new URL(value, base)
  } catch {
    return null
  }
  if (url.origin !== base) return null
  // Back to the login page would only loop.
  if (url.pathname === '/login' || url.pathname.startsWith('/login/')) return null
  return `${url.pathname}${url.search}${url.hash}`
}
