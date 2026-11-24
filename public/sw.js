/*
 * KitchenERP service worker (Week 12 PWA). Deliberately minimal:
 *
 * - It caches ONE file, /offline.html, and nothing else — no pages, no API
 *   responses, no stock figures — so nobody is ever shown yesterday's numbers.
 * - It only handles page navigations: straight to the network as usual, and
 *   only when that fails (no signal) does it answer with the offline page
 *   instead of the browser's own error. Every other request (scripts, API
 *   calls, images) is left to the browser untouched.
 *
 * Bump CACHE when offline.html changes; activate deletes the old one.
 */
const CACHE = 'kitchen-erp-offline-v1'
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(new Request(OFFLINE_URL, { cache: 'reload' }))))
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE_URL)),
  )
})
