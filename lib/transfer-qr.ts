/**
 * What a scanned QR means (Week 12): a transfer label holds the transfer's
 * page as a full link (absoluteUrl, lib/app-url.ts). Returns that page's path
 * — to open on THIS app, whatever host printed it — or null for anything
 * else: another site, another page, a plain number, junk. The scanner never
 * follows the scanned text itself, so a QR cannot send anyone off-site.
 *
 * `origins`: the hosts a label may name — the app's own address
 * (NEXT_PUBLIC_APP_URL, what labels are printed with) and the one the page is
 * open on, which differ behind a tunnel or a second hostname.
 */
export function transferPathFromQr(text: string, origins: string[]): string | null {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return null
  }
  if (!origins.includes(url.origin)) return null
  // Transfer ids are cuids: lowercase letters and digits.
  const match = /^\/inventory\/transfers\/([a-z0-9]{20,40})\/?$/.exec(url.pathname)
  return match ? `/inventory/transfers/${match[1]}` : null
}
