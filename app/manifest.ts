import type { MetadataRoute } from 'next'

/**
 * The web app manifest (Week 12 PWA): what makes KitchenERP installable —
 * "Add to Home Screen" gives it an icon and it opens full screen
 * (`standalone`), without the browser's address bar. Next serves this as
 * /manifest.webmanifest and links it from every page. The middleware lets it
 * through without a session: the browser fetches it without cookies.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id:               '/',
    name:             'KitchenERP',
    short_name:       'KitchenERP',
    description:      'Kitchen operations — procurement, production, inventory, costing and approvals.',
    start_url:        '/dashboard',
    scope:            '/',
    display:          'standalone',
    // White like the top bar, so the phone's status bar runs into it; gray-50 like the page behind the splash icon.
    theme_color:      '#ffffff',
    background_color: '#f9fafb',
    icons: [
      { src: '/icons/icon-192.png',          sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png',          sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Android crops this one to its own icon shape — full bleed, the K inside the safe zone.
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      // Long-press the icon: straight to receiving, the job outlets open it for.
      { name: 'Receive', url: '/inventory/receive', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  }
}
