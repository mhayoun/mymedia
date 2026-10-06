/// <reference lib="webworker" />
// Service worker: caches the app itself so it opens offline, and receives
// files shared to MyMedia from the phone's Share menu (Android).
// Thumbnails are cached by the app in IndexedDB, media is never cached here.

import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { clientsClaim } from 'workbox-core'

declare const self: ServiceWorkerGlobalScope

const SHARED_CACHE = 'mymedia-shared'

self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Shared files are kept until the app has uploaded them (or the user cancelled).
registerRoute(
  ({ url, request }) => request.method === 'POST' && url.pathname.endsWith('/share-target'),
  async ({ request }) => {
    const form = await request.formData()
    const files = form.getAll('media').filter((f): f is File => f instanceof File)
    const cache = await caches.open(SHARED_CACHE)
    for (const key of await cache.keys()) await cache.delete(key)
    for (const [i, file] of files.entries()) {
      await cache.put(
        new Request(`${self.registration.scope}shared/${i}`),
        new Response(file, {
          headers: {
            'content-type': file.type || 'application/octet-stream',
            'x-name': encodeURIComponent(file.name),
            'x-modified': String(file.lastModified || Date.now()),
          },
        }),
      )
    }
    return Response.redirect(`${self.registration.scope}?shared=${files.length}`, 303)
  },
  'POST',
)

registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))
