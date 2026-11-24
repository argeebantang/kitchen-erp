'use client'

import { useEffect } from 'react'

/**
 * Registers public/sw.js (Week 12 PWA) once the page has loaded. Only on a
 * secure page — the browser refuses a service worker on plain http other
 * than localhost — and quietly: the app works the same without one.
 * Renders nothing.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(err => {
      console.warn('[pwa] service worker not registered', err)
    })
  }, [])
  return null
}
