import { config } from '@/lib/config'

/**
 * A page of the app as a full link — for an email button or a printed QR
 * code, which leave the app and must find their way back. Built only from
 * NEXT_PUBLIC_APP_URL and an app path, never from request input, so it
 * cannot be steered to another site.
 */
export function absoluteUrl(href: string): string {
  return `${config.appUrl.replace(/\/+$/, '')}${href.startsWith('/') ? href : `/${href}`}`
}
